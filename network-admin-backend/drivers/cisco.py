import ipaddress
import re
from contextlib import contextmanager
from netmiko import ConnectHandler
from .base import BaseNetworkDriver


class CiscoIOSDriver(BaseNetworkDriver):

    # MikroTik primjenjuje izmjene trajno, a Cisco tek nakon "write memory"
    # Radi ujednačenog ponašanja snima se konfiguracija nakon svake izmjene
    SAVE_CONFIG = True

    _ACTION_MAP = {"accept": "permit", "drop": "deny", "reject": "deny"}
    _ERROR_RE = re.compile(r"^%\s*(invalid|incomplete|ambiguous|unknown|bad|error)", re.IGNORECASE | re.MULTILINE)

    ##POMOĆNE FUNKCIJE#########################################################

    def _has_error(self, output: str) -> bool:
        return bool(self._ERROR_RE.search(output))

    @contextmanager
    def _session(self):
        """Otvara SSH sesiju i ulazi u privilegovani mod."""
        with ConnectHandler(**self.config) as conn:
            conn.enable()
            yield conn

    def _show_raw(self, command: str) -> str:
        with self._session() as conn:
            output = conn.send_command(command)
        if self._has_error(output):
            raise ValueError(f"Cisco greška: {output.strip()}")
        return output

    def _apply(self, conn, commands: list[str]) -> str:
        """Šalje konfiguracione naredbe, provjerava greške i (opcionalno) snima konfiguraciju."""
        # cmd_verify=False: Netmiko ne čeka tačan echo svake naredbe (može pasti na ReadTimeout kad uređaj
        # usred unosa ispiše log poruku ili sporo odgovori) a greške se i dalje detektuju iz outputa
        output = conn.send_config_set(commands, cmd_verify=False, read_timeout=30)
        if self._has_error(output):
            raise ValueError(f"Cisco greška: {output.strip()}")
        if self.SAVE_CONFIG:
            conn.send_command("write memory")
        return output

    def _config(self, commands: list[str]) -> str:
        with self._session() as conn:
            return self._apply(conn, commands)

    @staticmethod
    def _cisco_mac(mac_address: str) -> str:
        clean = re.sub(r"[^0-9a-fA-F]", "", mac_address).lower()
        if len(clean) != 12:
            raise ValueError(f"Neispravna MAC adresa: {mac_address}")
        return f"{clean[0:4]}.{clean[4:8]}.{clean[8:12]}"

    @staticmethod
    def _cisco_network(ranges: str) -> str:
        value = ranges.strip()
        if "-" in value:
            raise ValueError("Cisco DHCP pool prima mrežu (npr. 192.168.1.0/24), a ne raspon adresa")
        if "/" in value:
            try:
                net = ipaddress.ip_network(value, strict=False)
            except ValueError:
                raise ValueError(f"Neispravna mreža: {ranges}")
            return f"{net.network_address} {net.netmask}"
        if len(value.split()) != 2:
            raise ValueError("Mreža mora biti u formatu 'adresa/prefiks' ili 'adresa maska'")
        return value

    @staticmethod
    def _cisco_ip_mask(ip_address: str) -> str:
        # "192.168.10.1/24" -> "192.168.10.1 255.255.255.0"
        try:
            iface = ipaddress.ip_interface(ip_address.strip())
        except ValueError:
            raise ValueError(f"Neispravna IP adresa (očekuje se format 192.168.10.1/24): {ip_address}")
        if iface.version != 4 or "/" not in ip_address:
            raise ValueError("IP adresa mora biti IPv4 u formatu adresa/prefiks (npr. 192.168.10.1/24)")
        return f"{iface.ip} {iface.netmask}"

    @staticmethod
    def _port_clause(port) -> str:
        port = str(port).strip()
        if "," in port:
            raise ValueError("Cisco ACL ne podržava listu portova u jednom pravilu, kreirajte zasebna pravila")
        if "-" in port:
            low, high = (p.strip() for p in port.split("-", 1))
            return f" range {low} {high}"
        return f" eq {port}"

    ##PARSERI OUTPUTA###########################################################
    # Cisco vraća tekst, pa se taj tekst pretvara u listu rječnika (isto kao MikroTik), da UI može prikazati tabele i dugmad za brisanje 
    # Ako parser ništa ne prepozna, a output ima sadržaja, vraća se [{"raw_output": ...}] da  UI može prikazati sirovi CLI ispis

    _IPV4 = r"\d{1,3}(?:\.\d{1,3}){3}"

    @staticmethod
    def _structured(rows: list[dict], raw: str, marker: str) -> list[dict]:
        if rows:
            return rows
        if re.search(marker, raw, re.MULTILINE):
            return [{"raw_output": raw}]
        return []

    def _parse_dhcp_bindings(self, text: str) -> list[dict]:
        pattern = re.compile(
            rf"^({self._IPV4})\s+(\S+)\s+(.+?)\s+(Automatic|Manual|On-demand)\b\s*(\S*)\s*(\S*)\s*$",
            re.MULTILINE,
        )
        return [
            {
                "ip_address": m.group(1),
                "client_id": m.group(2),
                "lease_expiration": m.group(3).strip(),
                "type": m.group(4),
                "state": m.group(5),
                "interface": m.group(6),
            }
            for m in pattern.finditer(text)
        ]

    def _parse_dhcp_pools(self, text: str) -> list[dict]:
        rows = []
        for part in re.split(r"(?m)^Pool\s+", text)[1:]:
            name = part.split(":", 1)[0].strip()

            def number(label):
                m = re.search(rf"{label}\s*:\s*(\d+)", part)
                return m.group(1) if m else ""

            rng = re.search(rf"{self._IPV4}\s+({self._IPV4})\s+-\s+({self._IPV4})", part)
            rows.append({
                "name": name,
                "range": f"{rng.group(1)} - {rng.group(2)}" if rng else "",
                "total": number("Total addresses"),
                "leased": number("Leased addresses"),
                "excluded": number("Excluded addresses"),
            })
        return rows

    def _parse_access_lists(self, text: str) -> list[dict]:
        rows = []
        current = None
        for line in text.splitlines():
            header = re.match(r"^(Standard|Extended)\s+IP access list\s+(\S+)", line)
            if header:
                current = {"type": header.group(1).lower(), "name": header.group(2)}
                continue
            if line and not line[0].isspace():
                current = None  # neki drugi blok (npr. IPv6 ACL)
                continue
            entry = re.match(r"^\s+(\d+)\s+(.+?)\s*$", line)
            if current and entry:
                rule = re.sub(r"\s*\(\d+ match(?:es)?\)\s*$", "", entry.group(2))
                rows.append({
                    "acl_name": current["name"],
                    "acl_type": current["type"],
                    "sequence": int(entry.group(1)),
                    "action": rule.split()[0],
                    "rule": rule,
                    "id": f"{current['name']}:{entry.group(1)}",  # ovo je format koji očekuje remove_firewall_rule
                })
        return rows

    @staticmethod
    def _parse_vlan_brief(text: str) -> list[dict]:
        rows = []
        for line in text.splitlines():
            m = re.match(r"^(\d+)\s+(\S+)\s+(active|act/\S+|sus\S*)\s*(.*)$", line)
            if m:
                rows.append({
                    "vlan_id": int(m.group(1)),
                    "name": m.group(2),
                    "status": m.group(3),
                    "ports": m.group(4).strip(),
                })
            elif rows and re.match(r"^\s{10,}\S", line):
                # nastavak liste portova iz prethodnog reda
                extra = line.strip()
                rows[-1]["ports"] = f"{rows[-1]['ports']} {extra}".strip()
        return rows

    ##FUNKCIJE ZA DOHVATANJE, DODAVANJE I BRISANJE DHCP LEASE-a#################

    def get_dhcp_leases(self) -> list[dict]:
        raw = self._show_raw("show ip dhcp binding")
        return self._structured(self._parse_dhcp_bindings(raw), raw, self._IPV4)

    def add_dhcp_reservation(self, ip_address: str, mac_address: str, comment: str = "") -> str:
        try:
            ipaddress.ip_address(ip_address)
        except ValueError:
            raise ValueError(f"Neispravna IP adresa: {ip_address}")

        cisco_mac = self._cisco_mac(mac_address)
        pool_name = f"STATIC_{ip_address.replace('.', '_')}"

        config_commands = [
            f"ip dhcp pool {pool_name}",
            f"host {ip_address}",
            f"client-identifier 01{cisco_mac}",
            
        ]
        if comment:
            # client-name ne smije sadržavati razmake
            client_name = re.sub(r"\s+", "-", comment.strip())
            config_commands.append(f"client-name {client_name}")

        self._config(config_commands)
        return f"Statička DHCP rezervacija kreirana na Cisco ruteru ({pool_name})."

    def remove_dhcp_lease(self, lease_id: str) -> str:
        # Kod Cisco IOS-a lease_id je IP adresa
        try:
            ipaddress.ip_address(lease_id)
        except ValueError:
            raise ValueError(f"Neispravna IP adresa: {lease_id}")

        with ConnectHandler(**self.config) as conn:
            conn.enable()
            output = conn.send_command(f"clear ip dhcp binding {lease_id}")
            if self._has_error(output):
                raise ValueError(f"Cisco greška: {output.strip()}")
            return output if output else f"Binding za IP {lease_id} očišćen na Cisco ruteru."

    ##FUNKCIJE ZA DOHVATANJE, DODAVANJE I BRISANJE DHCP POOL-A###################

    def get_dhcp_pools(self) -> list[dict]:
        raw = self._show_raw("show ip dhcp pool")
        return self._structured(self._parse_dhcp_pools(raw), raw, r"^Pool\s")

    def add_dhcp_pool(self, name: str, ranges: str) -> str:
        self._config([
            f"ip dhcp pool {name}",
            f"network {self._cisco_network(ranges)}",
        ])
        return f"Pool '{name}' kreiran na Cisco ruteru."

    def remove_dhcp_pool(self, pool_name: str) -> str:
        self._config([f"no ip dhcp pool {pool_name}"])
        return f"Pool '{pool_name}' uklonjen sa Cisco rutera."

    ##FUNKCIJE ZA FIREWALL / ACL#################################################

    def get_firewall_rules(self) -> list[dict]:
        raw = self._show_raw("show access-lists")
        return self._structured(self._parse_access_lists(raw), raw, r"access list")

    def add_firewall_rule(
        self,
        action: str,
        comment: str = "",
        acl_name: str = "",
        protocol: str = "ip",
        source: str = "any",
        destination: str = "any",
        **conditions
    ) -> str:
        if not acl_name:
            raise ValueError("Za Cisco je obavezan naziv ACL-a (acl_name)")

        verb = self._ACTION_MAP.get(action.lower())
        if verb is None:
            raise ValueError(f"Nepodržana akcija za Cisco: '{action}'")

        # Portovi se pišu odmah iza adrese kojoj pripadaju:
        # permit tcp <src> [eq <port>] <dst> [eq <port>]
        rule = f"{verb} {protocol} {source}"
        if conditions.get("src_port"):
            rule += self._port_clause(conditions["src_port"])
        rule += f" {destination}"
        if conditions.get("dst_port"):
            rule += self._port_clause(conditions["dst_port"])

        commands = [f"ip access-list extended {acl_name}"]
        if comment:
            commands.append(f"remark {comment}")
        commands.append(rule)

        self._config(commands)
        return f"Firewall pravilo uspješno kreirano na Cisco uređaju (ACL {acl_name})."

    def remove_firewall_rule(self, rule_id: str) -> str:
        # rule_id je u formatu "NAZIV_ACL:REDNI_BROJ" (redni broj se vidi u "show access-lists")
        acl_name, sep, sequence = rule_id.partition(":")
        if not sep or not acl_name or not sequence.isdigit():
            raise ValueError("Za Cisco rule_id mora biti u formatu 'NAZIV_ACL:REDNI_BROJ' (npr. BLOCK_WEB:10)")

        with self._session() as conn:
            output = conn.send_command(f"show access-lists {acl_name}")
            header = re.search(r"^(Standard|Extended)\s+IP access list", output, re.MULTILINE)
            if not header:
                raise ValueError(f"ACL '{acl_name}' nije pronađen na Cisco uređaju")
            kind = header.group(1).lower()
            self._apply(conn, [f"ip access-list {kind} {acl_name}", f"no {sequence}"])
        return f"Pravilo {sequence} uspješno uklonjeno iz ACL-a '{acl_name}' na Cisco uređaju."

    ##FUNKCIJE ZA VLAN#########################################################
    #
    # Cisco uređaji rade VLAN na dva načina, pa se tip uređaja detektuje automatski:
    #   - "switch": uređaj ima VLAN bazu (naredba "show vlan brief" postoji) -> "vlan 10" / "name X"
    #   - "router": nema VLAN bazu -> router-on-a-stick, VLAN je pod-interface
    #               (interface Gi0/0.10 / encapsulation dot1Q 10)

    def _vlan_brief(self, conn) -> str | None:
        """Output 'show vlan brief', ili None ako uređaj nema VLAN bazu (ruter)."""
        output = conn.send_command("show vlan brief")
        return output if output.strip() and not self._has_error(output) else None

    def _is_switch(self, conn) -> bool:
        return self._vlan_brief(conn) is not None

    def get_vlan_mode(self) -> str:
        with self._session() as conn:
            return "switch" if self._is_switch(conn) else "router"

    @staticmethod
    def _parse_subinterfaces(config_text: str) -> list[dict]:
        """Iz 'show running-config | section ^interface' izvlači pod-interface-e sa dot1Q enkapsulacijom."""
        results = []
        for block in re.split(r"(?m)^interface\s+", config_text)[1:]:
            lines = block.splitlines()
            ifname = lines[0].strip()
            body = "\n".join(lines[1:])

            encap = re.search(r"^\s*encapsulation dot1Q (\d+)", body, re.IGNORECASE | re.MULTILINE)
            if "." not in ifname or not encap:
                continue

            description = re.search(r"^\s*description\s+(.+?)\s*$", body, re.MULTILINE)
            ip = re.search(r"^\s*ip address\s+(\S+)\s+(\S+)", body, re.MULTILINE)
            results.append({
                "vlan_id": int(encap.group(1)),
                "name": description.group(1) if description else "",
                "interface": ifname.rsplit(".", 1)[0],
                "subinterface": ifname,
                "ip_address": ip.group(1) if ip else "",
                "mask": ip.group(2) if ip else "",
            })
        return results

    def _router_vlans(self, conn) -> list[dict]:
        output = conn.send_command("show running-config | section ^interface")
        return self._parse_subinterfaces(output)

    def get_vlans(self) -> list[dict]:
        with self._session() as conn:
            brief = self._vlan_brief(conn)
            if brief is not None:
                return self._structured(self._parse_vlan_brief(brief), brief, r"^\d+\s")
            return self._router_vlans(conn)

    def add_vlan(
        self,
        name: str,
        vlan_id: int,
        interface: str = "",
        comment: str = "",
        ip_address: str = ""
    ) -> str:
        with self._session() as conn:
            if self._is_switch(conn):
                commands = [f"vlan {vlan_id}"]
                if name:
                    commands.append(f"name {name}")
                self._apply(conn, commands)

                message = f"VLAN {vlan_id} uspješno kreiran na Cisco switchu."
                if interface or ip_address:
                    message += " (Parametri 'interface' i 'ip_address' se ne primjenjuju na switchu.)"
                return message

            # Router-on-a-stick
            if not interface:
                raise ValueError(
                    "Ovaj Cisco uređaj je ruter (nema VLAN bazu), pa je obavezan 'interface' "
                    "fizičkog porta, npr. GigabitEthernet0/0"
                )
            if "." in interface:
                raise ValueError("Navedite fizički interface bez oznake pod-interface-a (npr. GigabitEthernet0/0)")

            subinterface = f"{interface}.{vlan_id}"
            commands = [
                f"interface {interface}",
                "no shutdown",
                f"interface {subinterface}",
            ]
            description = " - ".join(part for part in (name, comment) if part)
            if description:
                commands.append(f"description {description}")
            commands.append(f"encapsulation dot1Q {vlan_id}")
            if ip_address:
                commands.append(f"ip address {self._cisco_ip_mask(ip_address)}")

            self._apply(conn, commands)
            return f"VLAN {vlan_id} kreiran na Cisco ruteru kao pod-interface {subinterface}."

    def remove_vlan(self, vlan_name: str) -> str:
        # Prima naziv VLAN-a (kao MikroTik), ID VLAN-a, a na ruteru i puni naziv pod-interface-a
        value = str(vlan_name).strip()

        with self._session() as conn:
            if self._is_switch(conn):
                vlan_id = self._resolve_switch_vlan_id(conn, value)
                self._apply(conn, [f"no vlan {vlan_id}"])
                return f"VLAN {vlan_id} uspješno uklonjen sa Cisco switcha."

            subinterface = self._resolve_subinterface(conn, value)
            self._apply(conn, [f"no interface {subinterface}"])
            return f"Pod-interface {subinterface} uspješno uklonjen sa Cisco rutera."

    def _resolve_switch_vlan_id(self, conn, value: str) -> int:
        if value.isdigit():
            return int(value)
        for vlan in self._parse_vlan_brief(self._vlan_brief(conn) or ""):
            if vlan["name"] == value:
                return vlan["vlan_id"]
        raise ValueError(f"VLAN '{value}' nije pronađen na Cisco uređaju")

    def _resolve_subinterface(self, conn, value: str) -> str:
        vlans = self._router_vlans(conn)

        if "." in value:  # puni naziv, npr. GigabitEthernet0/0.10
            matches = [v for v in vlans if v["subinterface"].lower() == value.lower()]
        elif value.isdigit():
            matches = [v for v in vlans if v["vlan_id"] == int(value)]
        else:
            matches = [v for v in vlans if v["name"] == value]

        if not matches:
            raise ValueError(f"VLAN '{value}' nije pronađen na Cisco ruteru")
        if len(matches) > 1:
            names = ", ".join(v["subinterface"] for v in matches)
            raise ValueError(f"'{value}' odgovara više pod-interface-a ({names}), navedite puni naziv")
        return matches[0]["subinterface"]
