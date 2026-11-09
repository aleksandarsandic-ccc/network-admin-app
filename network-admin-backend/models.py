from sqlalchemy import Column, Integer, String, Boolean
from database import Base

class Device(Base):
    __tablename__="devices"

    id = Column(Integer, primary_key=True, index=True)
    device_type = Column(String, default="unknown")
    hostname = Column(String, nullable=True)
    ip_address = Column(String, unique=True, index=True, nullable=False)
    status_online = Column(Boolean, default=True)
    mac_address = Column(String, unique=True, index=True, nullable=False)
    vendor = Column(String, nullable=False)


class ManagedDevice(Base):
    __tablename__ = "managed_devices"
    id = Column(Integer, primary_key=True)
    name = Column(String)         
    host = Column(String)         
    port = Column(Integer, default=22)
    username = Column(String)
    password = Column(String, nullable=False)      
    vendor = Column(String)      