import ipaddress
from fastapi import APIRouter, HTTPException, Depends
from netmiko.exceptions import NetmikoTimeoutException, NetmikoAuthenticationException
from network_factory import get_network_driver
from schemas import DHCPPoolCreate, FirewallRuleCreate
from sqlalchemy.orm import Session
import models
from database import get_db
from security import decrypt_password

router = APIRouter()


def get_device_or_404(device_id: int, db: Session):
    db_device = db.query(models.ManagedDevice).filter(models.ManagedDevice.id == device_id).first()
    if db_device is None:
        raise HTTPException(status_code=404, detail="Uređaj nije pronađen")
    return db_device


def build_driver(db_device):
    connection_info = {
        "host": db_device.host,
        "port": db_device.port,
        "username": db_device.username,
        "password": decrypt_password(db_device.password),
        "secret": decrypt_password(db_device.password),
    }

    return get_network_driver(db_device.vendor, connection_info)


def get_driver_for_device(device_id: int, db: Session):
    return build_driver(get_device_or_404(device_id, db))


def to_cisco_address(addr: str | None) -> str:
    """Pretvara '192.168.1.0/24' u '192.168.1.0 0.0.0.255', '1.2.3.4' u 'host 1.2.3.4', prazno u 'any'."""
    if not addr or addr.strip().lower() == "any":
        return "any"
    try:
        net = ipaddress.ip_network(addr.strip(), strict=False)
    except ValueError:
        raise ValueError(f"Neispravna IP adresa/mreža: {addr}")
    if net.version != 4:
        raise ValueError("Cisco ACL rute trenutno podržavaju samo IPv4 adrese")
    if net.prefixlen == net.max_prefixlen:
        return f"host {net.network_address}"
    return f"{net.network_address} {net.hostmask}"


def build_firewall_kwargs(vendor: str, rule: FirewallRuleCreate) -> dict:
    """Priprema argumente za driver.add_firewall_rule() u obliku koji očekuje dati vendor."""
    vendor = (vendor or "").lower()

    if "mikrotik" in vendor:
        if not rule.chain:
            raise ValueError("Za MikroTik je obavezno polje 'chain' (npr. input, forward, output)")
        conditions = {
            key: value
            for key, value in {
                "protocol": rule.protocol,
                "src-address": rule.src_address,
                "dst-address": rule.dst_address,
                "src-port": rule.src_port,
                "dst-port": rule.dst_port,
            }.items()
            if value not in (None, "")
        }
        return {
            "chain": rule.chain,
            "action": rule.action,
            "comment": rule.comment,
            **conditions,
        }

    if "cisco" in vendor:
        if not rule.acl_name:
            raise ValueError("Za Cisco je obavezno polje 'acl_name' (naziv ACL-a)")

        protocol = (rule.protocol or "ip").lower()
        if (rule.src_port or rule.dst_port) and protocol not in ("tcp", "udp"):
            raise ValueError("Portovi se mogu koristiti samo uz protokol tcp ili udp")

        kwargs = {
            "acl_name": rule.acl_name,
            "action": rule.action,
            "protocol": protocol,
            "source": to_cisco_address(rule.src_address),
            "destination": to_cisco_address(rule.dst_address),
            "comment": rule.comment or "",
        }
        # Cisco driver očekuje ključeve src_port / dst_port (sa underscore-om)
        if rule.src_port:
            kwargs["src_port"] = rule.src_port
        if rule.dst_port:
            kwargs["dst_port"] = rule.dst_port
        return kwargs

    raise ValueError(f"Vendor '{vendor}' nije podržan za firewall pravila")


# DHCP rute
############################################################

@router.get("/dhcp/leases/{device_id}")
def list_dhcp_leases(device_id: int, db: Session = Depends(get_db)):
    try:
        driver = get_driver_for_device(device_id, db)
        return driver.get_dhcp_leases()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NetmikoTimeoutException:
        raise HTTPException(status_code=504, detail="Ruter ne odgovara (timeout)")
    except NetmikoAuthenticationException:
        raise HTTPException(status_code=401, detail="Neuspješna autentikacija na ruteru")     


@router.post("/dhcp/leases/{device_id}")
def create_dhcp_reservation(
    device_id: int, 
    ip_address: str, 
    mac_address: str, 
    comment: str = "", 
    db: Session = Depends(get_db)
):
    try:
        driver = get_driver_for_device(device_id, db)
        result = driver.add_dhcp_reservation(ip_address, mac_address, comment)
        return {"message": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NetmikoTimeoutException:
        raise HTTPException(status_code=504, detail="Ruter ne odgovara (timeout)")
    except NetmikoAuthenticationException:
        raise HTTPException(status_code=401, detail="Neuspješna autentikacija na ruteru")


@router.delete("/dhcp/leases/{device_id}/{lease_id}")
def delete_dhcp_lease(device_id: int, lease_id: str, db: Session = Depends(get_db)):
    try:
        driver = get_driver_for_device(device_id, db)
        result = driver.remove_dhcp_lease(lease_id)
        return {"message": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NetmikoTimeoutException:
        raise HTTPException(status_code=504, detail="Ruter ne odgovara (timeout)")
    except NetmikoAuthenticationException:
        raise HTTPException(status_code=401, detail="Neuspješna autentikacija na ruteru")


@router.get("/dhcp/pools/{device_id}")
def list_dhcp_pools(device_id: int, db: Session = Depends(get_db)):
    try:
        driver = get_driver_for_device(device_id, db)
        return driver.get_dhcp_pools()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NetmikoTimeoutException:
        raise HTTPException(status_code=504, detail="Ruter ne odgovara (timeout)")
    except NetmikoAuthenticationException:
        raise HTTPException(status_code=401, detail="Neuspješna autentikacija na ruteru")


@router.post("/dhcp/pools/{device_id}")
def create_dhcp_pool(device_id: int, pool: DHCPPoolCreate, db: Session = Depends(get_db)):
    try:
        driver = get_driver_for_device(device_id, db)
        result = driver.add_dhcp_pool(
            name=pool.name,
            ranges=pool.ranges
        )
        return {"message": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NetmikoTimeoutException:
        raise HTTPException(status_code=504, detail="Ruter ne odgovara (timeout)")
    except NetmikoAuthenticationException:
        raise HTTPException(status_code=401, detail="Neuspješna autentikacija na ruteru")


@router.delete("/dhcp/pools/{device_id}/{pool_name}")
def delete_dhcp_pool(device_id: int, pool_name: str, db: Session = Depends(get_db)):
    try:
        driver = get_driver_for_device(device_id, db)
        result = driver.remove_dhcp_pool(pool_name)
        return {"message": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NetmikoTimeoutException:
        raise HTTPException(status_code=504, detail="Ruter ne odgovara (timeout)")
    except NetmikoAuthenticationException:
        raise HTTPException(status_code=401, detail="Neuspješna autentikacija na ruteru")


# Firewall rute
###############################################################################

@router.get("/firewall/{device_id}")
def list_firewall_rules(device_id: int, db: Session = Depends(get_db)):
    try:
        driver = get_driver_for_device(device_id, db)
        return driver.get_firewall_rules()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NetmikoTimeoutException:
        raise HTTPException(status_code=504, detail="Ruter ne odgovara (timeout)")
    except NetmikoAuthenticationException:
        raise HTTPException(status_code=401, detail="Neuspješna autentikacija na ruteru")


@router.post("/firewall/{device_id}")
def create_firewall_rule(
    device_id: int,
    rule: FirewallRuleCreate,
    db: Session = Depends(get_db)
):
    try:
        db_device = get_device_or_404(device_id, db)
        driver = build_driver(db_device)

        # Vendor se čita iz baze, a firewall parametri se prilagođavaju njegovoj šemi
        kwargs = build_firewall_kwargs(db_device.vendor, rule)

        result = driver.add_firewall_rule(**kwargs)
        return {"message": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NetmikoTimeoutException:
        raise HTTPException(status_code=504, detail="Ruter ne odgovara (timeout)")
    except NetmikoAuthenticationException:
        raise HTTPException(status_code=401, detail="Neuspješna autentikacija na ruteru")


@router.delete("/firewall/{device_id}/{rule_id}")
def delete_firewall_rule(device_id: int, rule_id: str, db: Session = Depends(get_db)):
    try:
        driver = get_driver_for_device(device_id, db)
        result = driver.remove_firewall_rule(rule_id)
        return {"message": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NetmikoTimeoutException:
        raise HTTPException(status_code=504, detail="Ruter ne odgovara (timeout)")
    except NetmikoAuthenticationException:
        raise HTTPException(status_code=401, detail="Neuspješna autentikacija na ruteru")


# VLAN rute
#############################################################################

@router.get("/vlans/{device_id}")
def list_vlans(device_id: int, db: Session = Depends(get_db)):
    try:
        driver = get_driver_for_device(device_id, db)
        return driver.get_vlans()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NetmikoTimeoutException:
        raise HTTPException(status_code=504, detail="Ruter ne odgovara (timeout)")
    except NetmikoAuthenticationException:
        raise HTTPException(status_code=401, detail="Neuspješna autentikacija na ruteru")


@router.get("/vlans/{device_id}/mode")
def get_vlan_mode(device_id: int, db: Session = Depends(get_db)):
    """'switch' (VLAN baza) ili 'router' (VLAN kao pod-interface, router-on-a-stick) - za prilagođavanje UI-ja."""
    try:
        driver = get_driver_for_device(device_id, db)
        return {"mode": driver.get_vlan_mode()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NetmikoTimeoutException:
        raise HTTPException(status_code=504, detail="Ruter ne odgovara (timeout)")
    except NetmikoAuthenticationException:
        raise HTTPException(status_code=401, detail="Neuspješna autentikacija na ruteru")


@router.post("/vlans/{device_id}")
def create_vlan(
    device_id: int,
    name: str,
    vlan_id: int,
    interface: str = "",
    ip_address: str = "",
    db: Session = Depends(get_db)
):
    try:
        driver = get_driver_for_device(device_id, db)
        result = driver.add_vlan(
            vlan_id=vlan_id,
            name=name, 
            interface=interface,
            ip_address=ip_address
        )
        return {"message": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NetmikoTimeoutException:
        raise HTTPException(status_code=504, detail="Ruter ne odgovara (timeout)")
    except NetmikoAuthenticationException:
        raise HTTPException(status_code=401, detail="Neuspješna autentikacija na ruteru")


@router.delete("/vlans/{device_id}/{vlan_name:path}")
def delete_vlan(device_id: int, vlan_name: str, db: Session = Depends(get_db)):
    try:
        driver = get_driver_for_device(device_id, db)
        result = driver.remove_vlan(vlan_name)
        return {"message": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NetmikoTimeoutException:
        raise HTTPException(status_code=504, detail="Ruter ne odgovara (timeout)")
    except NetmikoAuthenticationException:
        raise HTTPException(status_code=401, detail="Neuspješna autentikacija na ruteru")