from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from database import get_db
import models
from schemas import ManagedDeviceCreate, ManagedDeviceOut
from security import encrypt_password
from typing import List

router = APIRouter()


@router.post("/managed-devices", response_model=ManagedDeviceOut)
def create_managed_device(device: ManagedDeviceCreate, db: Session = Depends(get_db)):
    db_device = models.ManagedDevice(
        name=device.name,
        host=device.host,
        port=device.port,
        username=device.username,
        password=encrypt_password(device.password),   # enkripcija PRIJE upisa
        vendor=device.vendor.value
    )
    db.add(db_device)
    db.commit()
    db.refresh(db_device)
    return db_device


@router.get("/managed-devices", response_model=List[ManagedDeviceOut])
def list_managed_devices(db: Session = Depends(get_db)):
    return db.query(models.ManagedDevice).all()


@router.delete("/managed-devices/{device_id}")
def delete_managed_device(device_id: int, db: Session = Depends(get_db)):
    db_device = db.query(models.ManagedDevice).filter(models.ManagedDevice.id == device_id).first()
    if db_device is None:
        raise HTTPException(status_code=404, detail="Uređaj nije pronađen")
    db.delete(db_device)
    db.commit()
    return {"message": "Uređaj uklonjen"}