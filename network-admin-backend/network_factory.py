from drivers.base import BaseNetworkDriver
from drivers.mikrotik import MikroTikDriver
from drivers.cisco import CiscoIOSDriver

def get_network_driver(vendor: str, connection_info: dict) -> BaseNetworkDriver:
    vendor_lower = vendor.lower()
    config = connection_info.copy()   # kopija, ne diramo original

    if "mikrotik" in vendor_lower:
        config["device_type"] = "mikrotik_routeros"
        return MikroTikDriver(config)
    elif "cisco" in vendor_lower:
        config["device_type"] = "cisco_ios"
        return CiscoIOSDriver(config)
    else:
        raise ValueError(f"Nepodržan vendor/operativni sistem: '{vendor}'")