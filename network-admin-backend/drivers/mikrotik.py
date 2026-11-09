import ipaddress
import re
from netmiko import ConnectHandler
from .base import BaseNetworkDriver

class MikroTikDriver(BaseNetworkDriver):


    ##FUNKCIJE PARSIRANJA OUTPUTA SA TIKA#######################

    def _parse_terse_line(self, line: str) -> dict:
        pattern = r'([\w.-]+)=("[^"]*"|\S+)'
        matches = re.findall(pattern, line)
        item = {key: value.strip('"') for key, value in matches}
        # "print terse" ne mora vraćati .id, pa čuvamo redni broj stavke (može se koristiti za remove)
        index = re.match(r"^\s*(\d+)\s", line)
        if index and ".id" not in item:
            item["index"] = index.group(1)
        return item

    def _parse_terse_output(self, output: str) -> list[dict]:
        results = []
        for line in output.splitlines():
            if "=" in line:
                results.append(self._parse_terse_line(line))
        return results
    
    #############################################################


    ##FUNKCIJE ZA DOHVATANJE, DODAVANJE i BRISANJE DHCP LEASE-a####################################################

    def get_dhcp_leases(self) -> list[dict]:
        with ConnectHandler(**self.config) as conn:
            output = conn.send_command("/ip dhcp-server lease print terse")
            return self._parse_terse_output(output)

    def add_dhcp_reservation(self, ip_address: str, mac_address: str, comment: str = "") -> str:
       command = f'/ip dhcp-server lease add address={ip_address} mac-address={mac_address} comment="{comment}"'
       with ConnectHandler(**self.config) as conn:
           output = conn.send_command(command)
           if "failure" in output.lower() or "error" in output.lower():
               raise ValueError(f"MikroTik greška: {output.strip()}")
           return "Rezervacija uspješno kreirana na MikroTiku."

   

    def remove_dhcp_lease(self, lease_id: str) -> str:
        # lease_id je IP adresa (isto kao kod Cisca) ili interni ID/redni broj stavke
        try:
            ipaddress.ip_address(lease_id)
            command = f'/ip dhcp-server lease remove [find address="{lease_id}"]'
        except ValueError:
            command = f'/ip dhcp-server lease remove {lease_id}'
        with ConnectHandler(**self.config) as conn:
            output = conn.send_command(command)
            if "failure" in output.lower() or "error" in output.lower():
                raise ValueError(f"MikroTik greška: {output.strip()}")
            return "Lease uspješno uklonjen sa MikroTika."

    ###################################################################################################################
 
    ##FUNKCIJE ZA DOHVATANJE, DODAVANJE I BRISANJE DHCP POOL-OVA###############################
     
    def get_dhcp_pools(self) -> list[dict]:
        with ConnectHandler(**self.config) as conn:
            output = conn.send_command("/ip pool print terse")
            return self._parse_terse_output(output)

    def add_dhcp_pool(self, name: str, ranges: str) -> str:
        command = f'/ip pool add name="{name}" ranges={ranges}'
        with ConnectHandler(**self.config) as conn:
            output = conn.send_command(command)
            if "failure" in output.lower() or "error" in output.lower():
                raise ValueError(f"MikroTik greška: {output.strip()}")
            return "DHCP pool uspješno dodan na MikroTik."

    def remove_dhcp_pool(self, pool_name: str) -> str:
        command = f'/ip pool remove "{pool_name}"'
        with ConnectHandler(**self.config) as conn:
            output = conn.send_command(command)
            if "failure" in output.lower() or "error" in output.lower() or "no such item" in output.lower():
                raise ValueError(f"MikroTik greška: {output.strip()}")
            return "DHCP pool uspješno uklonjen sa MikroTika."

    ###########################################################################################

    #Funkcije za firewall

    def get_firewall_rules(self) -> list[dict]:
        with ConnectHandler(**self.config) as conn:
            output = conn.send_command("/ip firewall filter print terse")
            return self._parse_terse_output(output)

       
    def add_firewall_rule(self, action: str, comment: str = "", chain: str = "", **conditions) -> str:
        if not chain:
            raise ValueError("Za MikroTik je obavezan 'chain' (npr. input, forward, output)")
        extra_params = " ".join(f"{key}={value}" for key, value in conditions.items())
        command = f'/ip firewall filter add chain={chain} action={action} comment="{comment}" {extra_params}'
        with ConnectHandler(**self.config) as conn:
            output = conn.send_command(command)
            if "failure" in output.lower() or "error" in output.lower():
                raise ValueError(f"MikroTik greška: {output.strip()}")
            return "Firewall pravilo uspješno kreirano na Mikrotiku."


    def remove_firewall_rule(self, rule_id: str) -> str:
        command = f'/ip firewall filter remove "{rule_id}"'
        with ConnectHandler(**self.config) as conn:
                output = conn.send_command(command)
                if "failure" in output.lower() or "error" in output.lower():
                    raise ValueError(f"MikroTik greška: {output.strip()}")
                return "Firewall pravilo uspješno uklonjeno sa MikroTika."
            
 
    # Funkcije za VLAN

    def get_vlans(self) -> list[dict]:
        with ConnectHandler(**self.config) as conn:
            output = conn.send_command("/interface vlan print terse")
            return self._parse_terse_output(output)


    def add_vlan(
        self,
        name: str,
        vlan_id: int,
        interface: str = "",
        comment: str = "",
        ip_address: str = ""
    ) -> str:

        if not interface:
            raise ValueError("Za MikroTik je obavezan 'interface' na kojem se kreira VLAN")

        if ip_address:
            try:
                ipaddress.ip_interface(ip_address.strip())
            except ValueError:
                raise ValueError(f"Neispravna IP adresa (očekuje se format 192.168.10.1/24): {ip_address}")

        command = (
            f'/interface vlan add '
            f'name={name} '
            f'vlan-id={vlan_id} '
            f'interface={interface}'
        )

        if comment:
            command += f' comment="{comment}"'

        with ConnectHandler(**self.config) as conn:
            output = conn.send_command(command)

            if "failure" in output.lower() or "error" in output.lower():
                raise ValueError(
                    f"MikroTik greška: {output.strip()}"
                )

            if ip_address:
                ip_output = conn.send_command(f'/ip address add address={ip_address} interface={name}')
                if "failure" in ip_output.lower() or "error" in ip_output.lower():
                    raise ValueError(
                        f"MikroTik greška (VLAN je kreiran, IP adresa nije): {ip_output.strip()}"
                    )

            return "VLAN uspješno kreiran na MikroTiku."


    def remove_vlan(self, vlan_name: str) -> str:
        command = f'/interface vlan remove [find name="{vlan_name}"]'

        with ConnectHandler(**self.config) as conn:
            output = conn.send_command(command)

            if "failure" in output.lower() or "error" in output.lower():
                raise ValueError(
                    f"MikroTik greška: {output.strip()}"
                )

            return (
                output
                if output
                else f"VLAN '{vlan_name}' uspješno uklonjen sa MikroTika."
            )

