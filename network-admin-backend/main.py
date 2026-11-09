import sys
import os
import time
import socket
import platform
import subprocess
import threading
import ipaddress
import webbrowser
from typing import List
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor, as_completed

# 1. PRVI KORAK: Pronalaženje putanja i učitavanje .env fajla
def get_resource_path(relative_path: str) -> str:
    """ Vraća apsolutnu putanju do resursa unutar privremenog PyInstaller foldera """
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.abspath("."), relative_path)

def get_base_path(relative_path: str) -> str:
    """ Vraća putanju u stvarnom direktoriju gdje se nalazi .exe fajl (za bazu podataka) """
    if getattr(sys, 'frozen', False):
        return os.path.join(os.path.dirname(sys.executable), relative_path)
    return os.path.join(os.path.abspath("."), relative_path)

# Učitavanje .env fajla na samom vrhu
from dotenv import load_dotenv
env_path = get_resource_path(".env")
if os.path.exists(env_path):
    load_dotenv(dotenv_path=env_path)

# Postavljanje putanje za mac_vendor_lookup keš u stvarni direktorij da izbjegnemo PermissionError
os.environ["MAC_LOOKUP_CACHE"] = get_base_path("mac_vendors.txt")

# Ostatak imports
import uvicorn
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from netmiko.exceptions import ReadTimeout
from sqlalchemy.orm import Session
from apscheduler.schedulers.background import BackgroundScheduler

# Scapy imports
from scapy.all import Ether, ARP, srp
from mac_vendor_lookup import MacLookup

# Aplikativni imports
from database import Base, SessionLocal, engine, get_db
from models import Device as DatabaseDevice
from schemas import Device
from dhcp_routes import router as dhcp_router
from managed_device_routes import router as device_routes

# Kreiranje tabela u bazi podataka
Base.metadata.create_all(bind=engine)

def ping_device(ip_address: str, timeout: int = 2):
    """
    Koristi SISTEMSKI ping alat (ne scapy sr1). Scapy gradi vlastitu rutnu
    tabelu i kod GNS3/VPN/više-adapter okruženja često odabere pogrešan
    interfejs, pa paket nikad ne stigne ili se odgovor ne poveže nazad sa
    raw socketom - iako manuelni 'ping' sa iste mašine radi normalno jer
    koristi OS mrežni stek i njegovu (ispravnu) rutnu tabelu.
    """
    is_windows = platform.system().lower() == "windows"
    count_flag = "-n" if is_windows else "-c"
    timeout_flag = "-w" if is_windows else "-W"
    # Windows -w očekuje milisekunde, Linux/macOS -W očekuje sekunde
    timeout_value = str(int(timeout * 1000)) if is_windows else str(timeout)

    command = ["ping", count_flag, "1", timeout_flag, timeout_value, ip_address]

    start_time = time.time()
    try:
        result = subprocess.run(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout + 1
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return False, None
    end_time = time.time()

    if result.returncode == 0:
        latency_ms = (end_time - start_time) * 1000
        return True, round(latency_ms, 2)
    else:
        return False, None

def monitor_all_devices():
    db = SessionLocal()
    try:
        all_devices = db.query(DatabaseDevice).all()
        for device in all_devices:
            is_online, _ = ping_device(device.ip_address, timeout=1)
            device.status_online = is_online
        db.commit()
    except Exception as e:
        print(f"Greška tokom periodičnog pingovanja: {e}")
    finally:
        db.close()

scheduler = BackgroundScheduler()

@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler.add_job(monitor_all_devices, "interval", seconds=10)
    scheduler.start()
    yield
    scheduler.shutdown()

app = FastAPI(lifespan=lifespan)

@app.exception_handler(ReadTimeout)
async def netmiko_read_timeout_handler(request, exc):
    return JSONResponse(
        status_code=504,
        content={"detail": "Uređaj nije odgovorio na naredbu (read timeout)"},
    )

app.include_router(dhcp_router)
app.include_router(device_routes)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip

def get_ip_range(ip: str) -> str:
    parts = ip.split(".")
    return ".".join(parts[:3]) + ".0/24"

@app.get("/network/suggested-range")
def suggested_range():
    local_ip = get_local_ip()
    range_suggestion = get_ip_range(local_ip)
    return {"suggested_range": range_suggestion}

@app.get("/devices", response_model=List[Device])
def get_scanned_devices(db: Session = Depends(get_db)):
    return db.query(DatabaseDevice).all()

def is_local_network(ip_range: str) -> bool:
    """
    Provjerava da li je zadana mreža (ip_range) u istom L2 segmentu kao
    lokalna mrežna kartica. ARP sken radi samo za lokalni segment jer se
    broadcast paketi ne rutiraju kroz gateway.
    """
    try:
        local_ip = get_local_ip()
        local_network = ipaddress.ip_network(get_ip_range(local_ip), strict=False)
        target_network = ipaddress.ip_network(ip_range, strict=False)
        return local_network == target_network or local_network.overlaps(target_network)
    except Exception:
        return False


def scan_remote_network(ip_range: str, db: Session) -> List[DatabaseDevice]:
  
    network = ipaddress.ip_network(ip_range, strict=False)
    hosts = list(network.hosts())
    scanned_devices: List[DatabaseDevice] = []
    lock = threading.Lock()

    def check_host(ip_str: str):
        is_online, _ = ping_device(ip_str, timeout=1)
        if not is_online:
            return
        try:
            hostname = socket.gethostbyaddr(ip_str)[0]
        except socket.herror:
            hostname = f"Host-{ip_str.split('.')[-1]}"

        new_device = DatabaseDevice(
            device_type="unknown",
            hostname=hostname,
            ip_address=ip_str,
            mac_address=f"N/A-{ip_str}",
            status_online=True,
            vendor="N/A - udaljena mreža (ICMP sken)"
        )
        with lock:
            db.add(new_device)
            scanned_devices.append(new_device)

    with ThreadPoolExecutor(max_workers=50) as executor:
        futures = [executor.submit(check_host, str(ip)) for ip in hosts]
        for f in as_completed(futures):
            f.result()

    db.commit()
    for dev in scanned_devices:
        db.refresh(dev)

    return scanned_devices


@app.post("/devices/scan", response_model=List[Device])
def scan_active_devices(ip_range: str, db: Session = Depends(get_db)):
    db.query(DatabaseDevice).delete()
    db.commit()

    # Udaljene (rutirane) mreže ARP ne vidi - koristi ICMP ping sweep
    if not is_local_network(ip_range):
        return scan_remote_network(ip_range, db)

    # Slanje ARP zahtjeva (samo za lokalni segment)
    arp_request = Ether(dst="ff:ff:ff:ff:ff:ff") / ARP(op=1, pdst=ip_range)
    answered, _ = srp(arp_request, timeout=3, verbose=False)

    mac_lookup = MacLookup()
    try:
        mac_lookup.update_vendors()
    except Exception:
        pass

    scanned_devices = []
    
    for sent, received in answered:
        ip = received.psrc
        mac = received.hwsrc

        try:
            vendor = mac_lookup.lookup(mac)
        except Exception:
            vendor = "Nepoznat vendor"

        try:
            hostname = socket.gethostbyaddr(ip)[0]
        except socket.herror:
            hostname = f"Host-{ip.split('.')[-1]}"

        new_device = DatabaseDevice(
            device_type="unknown",
            hostname=hostname,
            ip_address=ip,
            mac_address=mac,
            status_online=True,
            vendor=vendor
        )
        db.add(new_device)
        scanned_devices.append(new_device)

    db.commit()

    for dev in scanned_devices:
        db.refresh(dev)

    return scanned_devices

# Statički fajlovi (React / Vue frontend)
static_dir = get_resource_path("static")

if os.path.exists(static_dir):
    assets_dir = os.path.join(static_dir, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def serve_react(full_path: str):
        file_path = os.path.join(static_dir, full_path)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(static_dir, "index.html"))

def open_browser():
    webbrowser.open("http://127.0.0.1:8000")

if __name__ == "__main__":
    threading.Timer(1.5, open_browser).start()
    uvicorn.run(app, host="127.0.0.1", port=8000)