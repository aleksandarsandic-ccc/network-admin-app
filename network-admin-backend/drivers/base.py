from abc import ABC, abstractmethod

class BaseNetworkDriver(ABC):

    def __init__(self, connection_info: dict):
        self.config = connection_info

    ########################################################
    #Metode za DHCP leases
    @abstractmethod
    def get_dhcp_leases(self) -> list[dict]:
        pass

    @abstractmethod
    def add_dhcp_reservation(self, ip_address: str, mac_address: str, comment: str = "") -> str:
        pass

    @abstractmethod
    def remove_dhcp_lease(self, lease_id: str) -> str:
        pass
    
    #########################################################
    #Metode za DHCP poolove
    @abstractmethod
    def get_dhcp_pools(self) -> list[dict]:
        pass

    @abstractmethod
    def add_dhcp_pool(self, name: str, ranges: str) -> str:
        pass

    @abstractmethod
    def remove_dhcp_pool(self, pool_name: str) -> str:
        pass
    
    ###########################################################
    #Metode za firewall 
    @abstractmethod
    def get_firewall_rules(self) -> list[dict]:
        pass

    @abstractmethod
    def add_firewall_rule(self, action: str, comment: str = "", **params) -> str:
        """
        Metoda postoji jer su parametri drugačiji za Mikrotik i za Cisco, šalje ih ruta create_firewall_rule
        MikroTik: chain, protocol, src-address, dst-address, src-port, dst-port
        Cisco: acl_name, protocol, source, destination, src_port, dst_port
        """
        pass
    
    @abstractmethod
    def remove_firewall_rule(self, rule_id: str) -> str:
        """
        rule_id: 
        MikroTik -> interni ID pravila (npr. *1); 
        Cisco -> 'NAZIV_ACL:REDNI_BROJ' (npr. 'BLOCK_WEB:10').
        """
        pass
   
   ##############################################################
   #Metode za VLAN-ove
    @abstractmethod
    def get_vlans(self) -> list[dict]:
         pass

    @abstractmethod
    def add_vlan(
            self,
            name: str,
            vlan_id: int,
            interface: str = "",
            comment: str = "",
            ip_address: str = ""
        ) -> str:
         pass
     
    def get_vlan_mode(self) -> str:
        """
        'switch' -> VLAN se kreira u VLAN bazi uređaja; 'router' -> VLAN je pod-interface na fizičkom portu
        (MikroTik i Cisco ruteri). Driver koji radi drugačije treba da nadjača ovu metodu.
        """
        return "router"

    @abstractmethod
    def remove_vlan(self, vlan_name: str) -> str:
         pass
    ##############################################################
