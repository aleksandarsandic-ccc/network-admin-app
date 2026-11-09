from pydantic import BaseModel, ConfigDict, Field
from enum import Enum
from typing import Optional, Literal

class DeviceType (str, Enum):
    ROUTER = "router"
    SWITCH = "switch"
    FIREWALL = "firewall"
    SERVER = "server"
    UNKNOWN = "unknown"

class Device(BaseModel):
    device_type: DeviceType = Field(default=DeviceType.UNKNOWN)
    hostname: Optional[str] = None
    ip_address: str
    status_online: bool
    mac_address: str
    vendor: Optional[str] = None

class DHCPReservationCreate(BaseModel):
    ip_address: str
    mac_address: str
    comment: Optional[str] = "Kreirano preko API-ja"

class DHCPPoolCreate(BaseModel):
    name: str
    ranges: str  

class VendorType(str, Enum):
    MIKROTIK = "mikrotik"
    CISCO = "cisco"

class FirewallRuleCreate(BaseModel):
    
    model_config = ConfigDict(populate_by_name=True)

    chain: Optional[str] = None      # MikroTik (input / forward / output)
    acl_name: Optional[str] = None   # Cisco (naziv ACL-a)
    action: Literal["accept", "drop", "reject"]
    comment: Optional[str] = ""

    protocol: Optional[str] = None
    src_address: Optional[str] = Field(default=None, alias="src-address")
    dst_address: Optional[str] = Field(default=None, alias="dst-address")
    src_port: Optional[str] = Field(default=None, alias="src-port")
    dst_port: Optional[str] = Field(default=None, alias="dst-port")


class ManagedDeviceCreate(BaseModel):
    name: Optional[str] = None
    host: str
    port: int = 22
    username: str
    password: str
    vendor: VendorType

class ManagedDeviceOut(BaseModel):
    id: int
    name: Optional[str] = None
    host: str
    port: int
    username: str
    vendor: VendorType
    