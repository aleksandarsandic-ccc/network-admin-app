import React, { useState, useEffect, useRef } from 'react';
import { Server, Layers, Shield, Trash2, RefreshCw, Plus, AlertCircle, Copy, Check, Terminal, CheckCircle2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Zajednički stilovi
// ---------------------------------------------------------------------------
const inputCls = "bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500 disabled:opacity-40";
const monoInputCls = `${inputCls} font-mono`;
const btnPrimaryCls = "bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold p-2 rounded-lg flex items-center justify-center gap-1 disabled:opacity-50";
const tableWrapCls = "bg-slate-900 border border-slate-700/60 rounded-lg overflow-x-auto text-xs";

// Sistemski VLAN-ovi koje Cisco switch ne dozvoljava obrisati
const isProtectedCiscoVlan = (id) => Number(id) === 1 || (Number(id) >= 1002 && Number(id) <= 1005);

// Prazna polja se ne šalju backendu
const clean = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== "" && v !== null && v !== undefined));

const defaultVlan = (isCisco) => ({
  name: "",
  vlan_id: "",
  interface: isCisco ? "GigabitEthernet0/0" : "ether1",
  ip_address: "",
});

const defaultRuleMikrotik = { chain: "input", action: "accept", comment: "", protocol: "", src_address: "", dst_address: "", src_port: "", dst_port: "" };
const defaultRuleCisco = { acl_name: "100", action: "accept", protocol: "ip", source: "any", destination: "any", src_port: "", dst_port: "", comment: "" };

// Cisco vraća ili listu redova ili [{ raw_output }] kad parser ne prepozna ispis
const isRawOutput = (data) => Array.isArray(data) && data.length > 0 && data[0]?.raw_output !== undefined;

// ---------------------------------------------------------------------------
// Komponente
// ---------------------------------------------------------------------------
function RawCliBox({ title, data }) {
  const [copied, setCopied] = useState(false);

  const extractRawOutput = (inputData) => {
    if (!inputData) return "";
    if (Array.isArray(inputData) && inputData.length > 0 && inputData[0]?.raw_output) return inputData[0].raw_output;
    if (typeof inputData === 'object' && inputData?.raw_output) return inputData.raw_output;
    if (typeof inputData === 'string') return inputData;
    return JSON.stringify(inputData, null, 2);
  };

  const displayContent = extractRawOutput(data);

  const handleCopy = () => {
    navigator.clipboard.writeText(displayContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 font-mono text-xs shadow-inner">
      <div className="flex justify-between items-center mb-3 pb-2 border-b border-slate-800/80 font-sans">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold">{title}</span>
        </div>
        <button
          onClick={handleCopy}
          className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition-all flex items-center gap-1 text-[11px]"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          {copied ? "Kopirano!" : "Kopiraj output"}
        </button>
      </div>
      <pre className="whitespace-pre-wrap leading-relaxed text-emerald-400 min-h-[60px] overflow-x-auto selection:bg-emerald-900 selection:text-emerald-200">
        {displayContent.trim() || "% Prazan odgovor sa Cisco CLI."}
      </pre>
    </div>
  );
}

// Generička tabela sa dugmetom za brisanje u zadnjoj koloni
function DataTable({ columns, rows, onDelete, canDelete, busy, emptyText = "Nema zapisa." }) {
  const list = Array.isArray(rows) ? rows : [];
  return (
    <div className={tableWrapCls}>
      <table className="w-full text-left">
        <thead className="bg-slate-800 text-slate-400 border-b border-slate-700">
          <tr>
            {columns.map((c) => <th key={c.header} className="p-2">{c.header}</th>)}
            <th className="p-2 text-right">Brisanje</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {list.length === 0 && (
            <tr><td colSpan={columns.length + 1} className="p-3 text-slate-500">{emptyText}</td></tr>
          )}
          {list.map((row, idx) => (
            <tr key={idx} className="hover:bg-slate-800/40">
              {columns.map((c) => <td key={c.header} className={`p-2 ${c.className || "text-slate-300"}`}>{c.cell(row)}</td>)}
              <td className="p-2 text-right">
                {canDelete && !canDelete(row) ? (
                  <span className="text-[11px] text-slate-600">sistemski</span>
                ) : (
                  <button
                    onClick={() => onDelete(row)}
                    disabled={busy}
                    title="Obriši"
                    aria-label="Obriši"
                    className="text-rose-400 hover:text-rose-300 p-1 disabled:opacity-40"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ActionChip = ({ value }) => {
  const v = String(value || "").toLowerCase();
  const style =
    v === "permit" || v === "accept" ? "bg-emerald-500/15 text-emerald-300" :
    v === "deny" || v === "drop" || v === "reject" ? "bg-rose-500/15 text-rose-300" :
    "bg-slate-700/60 text-slate-300";
  return <span className={`px-1.5 py-0.5 rounded font-semibold ${style}`}>{value || "-"}</span>;
};

// ---------------------------------------------------------------------------
// Glavna komponenta
// ---------------------------------------------------------------------------
export default function RouterConfig({ selectedDevice, apiBase }) {
  const [activeConfigModule, setActiveConfigModule] = useState("dhcp");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [notice, setNotice] = useState("");

  // Podaci sa API-ja
  const [dhcpLeases, setDhcpLeases] = useState([]);
  const [dhcpPools, setDhcpPools] = useState([]);
  const [vlans, setVlans] = useState([]);
  const [vlanMode, setVlanMode] = useState(null); // "switch" | "router" | null (još nepoznato)
  const [firewallRules, setFirewallRules] = useState([]);

  const rawVendor = typeof selectedDevice === 'object'
    ? (selectedDevice?.vendor || selectedDevice?.type || selectedDevice?.device_type || "")
    : "";

  const isCisco = Boolean(rawVendor && String(rawVendor).toLowerCase().includes("cisco"));
  const deviceId = typeof selectedDevice === 'object' ? selectedDevice?.id : selectedDevice;
  const baseUrl = (apiBase || "").endsWith('/') ? apiBase.slice(0, -1) : (apiBase || "");

  // Forme
  const [newLease, setNewLease] = useState({ ip: "", mac: "", comment: "" });
  const [newPoolMikrotik, setNewPoolMikrotik] = useState({ name: "", ranges: "" });
  const [newPoolCisco, setNewPoolCisco] = useState({ name: "", network: "", mask: "" });
  const [newVlan, setNewVlan] = useState(defaultVlan(isCisco));
  const [newRuleMikrotik, setNewRuleMikrotik] = useState(defaultRuleMikrotik);
  const [newRuleCisco, setNewRuleCisco] = useState(defaultRuleCisco);

  const requestRef = useRef(0);

  // Poziv API-ja: baca Error sa porukom backenda (detail) kad odgovor nije 2xx
  const api = async (path, options) => {
    let res;
    try {
      res = await fetch(`${baseUrl}${path}`, options);
    } catch {
      throw new Error("Greška pri komunikaciji sa backendom.");
    }
    let body = null;
    try { body = await res.json(); } catch { /* prazan odgovor */ }
    if (!res.ok) {
      const detail = body?.detail;
      const text = typeof detail === "string"
        ? detail
        : Array.isArray(detail) ? detail.map((d) => d.msg).join(", ") : `Greška ${res.status}`;
      throw new Error(text);
    }
    return body;
  };

  // Promjena uređaja: očisti prikaz prethodnog uređaja
  useEffect(() => {
    setDhcpLeases([]);
    setDhcpPools([]);
    setVlans([]);
    setFirewallRules([]);
    setVlanMode(null);
    setNotice("");
    setErrorMsg("");
    setNewVlan(defaultVlan(isCisco));
  }, [deviceId, isCisco]);

  useEffect(() => {
    if (deviceId) {
      loadModuleData();
    }
  }, [deviceId, activeConfigModule]);

  const loadModuleData = async () => {
    if (!deviceId) return;
    const reqId = ++requestRef.current;
    setLoading(true);
    setErrorMsg("");
    try {
      if (activeConfigModule === "dhcp") {
        const [leases, pools] = await Promise.all([
          api(`/dhcp/leases/${deviceId}`),
          api(`/dhcp/pools/${deviceId}`),
        ]);
        if (reqId !== requestRef.current) return;
        setDhcpLeases(leases ?? []);
        setDhcpPools(pools ?? []);

      } else if (activeConfigModule === "vlan") {
        // Tip uređaja odlučuje koja polja se prikazuju (switch = VLAN baza, ruter = pod-interface)
        const [mode, list] = await Promise.all([
          api(`/vlans/${deviceId}/mode`),
          api(`/vlans/${deviceId}`),
        ]);
        if (reqId !== requestRef.current) return;
        setVlanMode(mode?.mode ?? null);
        setVlans(list ?? []);

      } else if (activeConfigModule === "firewall") {
        const rules = await api(`/firewall/${deviceId}`);
        if (reqId !== requestRef.current) return;
        setFirewallRules(rules ?? []);
      }
    } catch (err) {
      if (reqId !== requestRef.current) return;
      console.error("Fetch Error:", err);
      setErrorMsg(err.message || "Greška pri komunikaciji sa ruterom ili backendom.");
    } finally {
      if (reqId === requestRef.current) setLoading(false);
    }
  };

  // Izvršava izmjenu, prikazuje poruku backenda ili grešku i osvježava listu.
  // Vraća true ako je uspjelo (forme se resetuju samo tada).
  const runAction = async (fn) => {
    setErrorMsg("");
    setNotice("");
    setBusy(true);
    try {
      const res = await fn();
      if (res?.message) setNotice(res.message);
      await loadModuleData();
      return true;
    } catch (err) {
      setErrorMsg(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const deleteItem = (path, label) => {
    if (!window.confirm(`Obrisati ${label}?`)) return;
    runAction(() => api(path, { method: "DELETE" }));
  };

  // ---- DHCP ----------------------------------------------------------------
  {/*const handleAddLease = (e) => {
    e.preventDefault();
    runAction(async () => {
      const q = new URLSearchParams({ ip_address: newLease.ip, mac_address: newLease.mac, comment: newLease.comment });
      const res = await api(`/dhcp/leases/${deviceId}?${q}`, { method: "POST" });
      setNewLease({ ip: "", mac: "", comment: "" });
      return res;
    });
  };*/}

  const handleAddLease = (e) => {
    e.preventDefault();

    // Validacija IP i MAC adrese za MikroTik (ili generalno)
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

    if (!ipRegex.test(newLease.ip.trim())) {
      setErrorMsg("Unesite validnu IP adresu (npr. 192.168.1.50).");
      return;
    }
    if (!macRegex.test(newLease.mac.trim())) {
      setErrorMsg("Unesite validnu MAC adresu (npr. AA:BB:CC:DD:EE:FF).");
      return;
    }

    runAction(async () => {
      const q = new URLSearchParams({ ip_address: newLease.ip, mac_address: newLease.mac, comment: newLease.comment });
      const res = await api(`/dhcp/leases/${deviceId}?${q}`, { method: "POST" });
      setNewLease({ ip: "", mac: "", comment: "" });
      return res;
    });
  };

  const handleDeleteLease = (id) =>
    deleteItem(`/dhcp/leases/${deviceId}/${encodeURIComponent(id)}`, `DHCP zapis ${id}`);

  {/*const handleAddPool = (e) => {
    e.preventDefault();
    const ipRangeRegex = /^(\d{1,3}\.){3}\d{1,3}(-\d{1,3}(\.\d{1,3}){3})?$/;
    runAction(async () => {
      const payload = isCisco
        ? { name: newPoolCisco.name, ranges: `${newPoolCisco.network} ${newPoolCisco.mask}` }
        : newPoolMikrotik;
      const res = await api(`/dhcp/pools/${deviceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (isCisco) setNewPoolCisco({ name: "", network: "", mask: "" });
      else setNewPoolMikrotik({ name: "", ranges: "" });
      return res;
    });
  };*/}

  /*const handleAddPool = (e) => {
    e.preventDefault();
    
    // Validacija za MikroTik opseg adresa (npr. IP1-IP2 ili validan format opsega)
    if (!isCisco) {
      const ipRangeRegex = /^(\d{1,3}\.){3}\d{1,3}(-\d{1,3}(\.\d{1,3}){3})?$/;
      if (!ipRangeRegex.test(newPoolMikrotik.ranges.trim())) {
        setErrorMsg("Unesite validan opseg adresa (npr. 192.168.1.10-192.168.1.100).");
        return;
      }
    }

    runAction(async () => {
      const payload = isCisco
        ? { name: newPoolCisco.name, ranges: `${newPoolCisco.network} ${newPoolCisco.mask}` }
        : newPoolMikrotik;
      const res = await api(`/dhcp/pools/${deviceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (isCisco) setNewPoolCisco({ name: "", network: "", mask: "" });
      else setNewPoolMikrotik({ name: "", ranges: "" });
      return res;
    });
  };*/


  const handleAddPool = (e) => {
  e.preventDefault();
  
  // RegEx za standardnu IPv4 adresu / subnet masku
  const ipRegex = /^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

  if (isCisco) {
    const network = newPoolCisco.network.trim();
    const mask = newPoolCisco.mask.trim();

    //Validacija IP adrese mreže
    if (!ipRegex.test(network)) {
      setErrorMsg("Unesite validnu Network IP adresu (npr. 192.168.1.0).");
      return;
    }

    //Validacija formata submet maske
    if (!ipRegex.test(mask)) {
      setErrorMsg("Unesite validnu Subnet Mask adresu (npr. 255.255.255.0).");
      return;
    }

    //Provjera da li je mrežna maska u ispravnom CIDR obliku
    const isValidSubnetMask = (maskStr) => {
      const octets = maskStr.split('.').map(Number);
      const binaryMask = octets.map(o => o.toString(2).padStart(8, '0')).join('');
      // Subnet maska mora imati sve jedinice na početku i sve nule na kraju
      return /^1*0*$/.test(binaryMask) && binaryMask.includes('1');
    };

    if (!isValidSubnetMask(mask)) {
      setErrorMsg("Neispravan format Subnet Mask-e (npr. mora biti 255.255.255.0, 255.255.240.0 i sl.).");
      return;
    }
  } else {
    // Validacija za MikroTik opseg adresa
    const ipRangeRegex = /^(\d{1,3}\.){3}\d{1,3}(-\d{1,3}(\.\d{1,3}){3})?$/;
    if (!ipRangeRegex.test(newPoolMikrotik.ranges.trim())) {
      setErrorMsg("Unesite validan opseg adresa (npr. 192.168.1.10-192.168.1.100).");
      return;
    }
  }

  runAction(async () => {
    const payload = isCisco
      ? { name: newPoolCisco.name.trim(), ranges: `${newPoolCisco.network.trim()} ${newPoolCisco.mask.trim()}` }
      : newPoolMikrotik;

    const res = await api(`/dhcp/pools/${deviceId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (isCisco) setNewPoolCisco({ name: "", network: "", mask: "" });
    else setNewPoolMikrotik({ name: "", ranges: "" });

    return res;
  });
};

  const handleDeletePool = (name) =>
    deleteItem(`/dhcp/pools/${deviceId}/${encodeURIComponent(name)}`, `DHCP pool ${name}`);

  // ---- VLAN ----------------------------------------------------------------
  /*const handleAddVlan = (e) => {
    e.preventDefault();
    runAction(async () => {
      const params = new URLSearchParams({ name: newVlan.name, vlan_id: newVlan.vlan_id });
      if (vlanMode === "router") {
        params.set("interface", newVlan.interface);
        if (newVlan.ip_address.trim()) params.set("ip_address", newVlan.ip_address.trim());
      }
      const res = await api(`/vlans/${deviceId}?${params}`, { method: "POST" });
      setNewVlan(defaultVlan(isCisco));
      return res;
    });
  };*/

  const handleAddVlan = (e) => {
    e.preventDefault();

    // Validacija IP adrese sa prefiksom za MikroTik / Layer 3 ruter
    const ipWithPrefixRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
    
    if (vlanMode === "router" && !isCisco && newVlan.ip_address.trim()) {
      if (!ipWithPrefixRegex.test(newVlan.ip_address.trim())) {
        setErrorMsg("IP adresa mora sadržavati i prefiks (npr. 192.168.1.1/24).");
        return;
      }
    }

    runAction(async () => {
      const params = new URLSearchParams({ name: newVlan.name, vlan_id: newVlan.vlan_id });
      if (vlanMode === "router") {
        params.set("interface", newVlan.interface);
        if (newVlan.ip_address.trim()) params.set("ip_address", newVlan.ip_address.trim());
      }
      const res = await api(`/vlans/${deviceId}?${params}`, { method: "POST" });
      setNewVlan(defaultVlan(isCisco));
      return res;
    });
  };

  const handleDeleteVlan = (id, label) =>
    deleteItem(`/vlans/${deviceId}/${encodeURIComponent(id)}`, label);

  // ---- Firewall --------------------------------------------------------------
  /*const handleAddFirewallRule = (e) => {
    e.preventDefault();
    runAction(async () => {
      const payload = isCisco
        ? clean({
            acl_name: newRuleCisco.acl_name,
            action: newRuleCisco.action,
            protocol: newRuleCisco.protocol,
            src_address: newRuleCisco.source,
            dst_address: newRuleCisco.destination,
            src_port: newRuleCisco.src_port,
            dst_port: newRuleCisco.dst_port,
            comment: newRuleCisco.comment,
          })
        : clean(newRuleMikrotik);
      const res = await api(`/firewall/${deviceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (isCisco) setNewRuleCisco(defaultRuleCisco);
      else setNewRuleMikrotik(defaultRuleMikrotik);
      return res;
    });
  };*/

  const handleAddFirewallRule = (e) => {
    e.preventDefault();

    // Validacija IP/CIDR adresa ukoliko nisu prazne za MikroTik
    if (!isCisco) {
      const ipOrCidrRegex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;

      if (newRuleMikrotik.src_address.trim() && !ipOrCidrRegex.test(newRuleMikrotik.src_address.trim())) {
        setErrorMsg("Izvorišna adresa (Src Address) mora biti validna IP adresa ili mreža (npr. 192.168.1.10 ili 192.168.1.0/24).");
        return;
      }
      if (newRuleMikrotik.dst_address.trim() && !ipOrCidrRegex.test(newRuleMikrotik.dst_address.trim())) {
        setErrorMsg("Odredišna adresa (Dst Address) mora biti validna IP adresa ili mreža (npr. 10.0.0.5 ili 10.0.0.0/24).");
        return;
      }
    }

    runAction(async () => {
      const payload = isCisco
        ? clean({
            acl_name: newRuleCisco.acl_name,
            action: newRuleCisco.action,
            protocol: newRuleCisco.protocol,
            src_address: newRuleCisco.source,
            dst_address: newRuleCisco.destination,
            src_port: newRuleCisco.src_port,
            dst_port: newRuleCisco.dst_port,
            comment: newRuleCisco.comment,
          })
        : clean(newRuleMikrotik);
      
      const res = await api(`/firewall/${deviceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      if (isCisco) setNewRuleCisco(defaultRuleCisco);
      else setNewRuleMikrotik(defaultRuleMikrotik);
      return res;
    });
  };

  const handleDeleteFirewallRule = (id, label) =>
    deleteItem(`/firewall/${deviceId}/${encodeURIComponent(id)}`, label);

  const ciscoPortsEnabled = ["tcp", "udp"].includes(newRuleCisco.protocol);

  // ---- Definicije kolona -----------------------------------------------------
  const mono = "font-mono text-slate-200";

  const leaseColumnsMikrotik = [
    { header: "IP adresa", className: mono, cell: (l) => l.address || l.ip },
    { header: "MAC adresa", className: "font-mono text-slate-400", cell: (l) => l["mac-address"] || l.mac },
    { header: "Komentar", cell: (l) => l.comment || "-" },
  ];
  const leaseColumnsCisco = [
    { header: "IP adresa", className: mono, cell: (l) => l.ip_address },
    { header: "Client ID / MAC", className: "font-mono text-slate-400", cell: (l) => l.client_id },
    { header: "Ističe", cell: (l) => l.lease_expiration },
    { header: "Tip", cell: (l) => l.type },
  ];

  const poolColumnsMikrotik = [
    { header: "Naziv pool-a", className: "font-medium text-slate-200", cell: (p) => p.name || p[".id"] },
    { header: "Opseg adresa", className: "font-mono text-slate-300", cell: (p) => p.ranges || "N/A" },
  ];
  const poolColumnsCisco = [
    { header: "Naziv pool-a", className: "font-medium text-slate-200", cell: (p) => p.name },
    { header: "Opseg adresa", className: "font-mono text-slate-300", cell: (p) => p.range || "N/A" },
    { header: "Zauzeto / Ukupno", className: "font-mono text-slate-400", cell: (p) => `${p.leased || 0} / ${p.total || 0}` },
  ];

  const vlanColumnsSwitch = [
    { header: "VLAN ID", className: "font-mono text-blue-400", cell: (v) => v.vlan_id },
    { header: "Naziv", className: "font-medium text-slate-200", cell: (v) => v.name },
    { header: "Status", cell: (v) => v.status },
    { header: "Portovi", className: "font-mono text-slate-400", cell: (v) => v.ports || "-" },
  ];
  const vlanColumnsCiscoRouter = [
    { header: "VLAN ID", className: "font-mono text-blue-400", cell: (v) => v.vlan_id },
    { header: "Naziv", className: "font-medium text-slate-200", cell: (v) => v.name || "-" },
    { header: "Pod-interface", className: "font-mono text-slate-300", cell: (v) => v.subinterface },
    { header: "IP adresa", className: "font-mono text-slate-400", cell: (v) => (v.ip_address ? `${v.ip_address} ${v.mask}` : "-") },
  ];
  const vlanColumnsMikrotik = [
    { header: "VLAN ID", className: "font-mono text-blue-400", cell: (v) => v["vlan-id"] || v.vlan_id },
    { header: "Naziv", className: "font-medium text-slate-200", cell: (v) => v.name },
    { header: "Interfejs", className: "font-mono text-slate-300", cell: (v) => v.interface || "Internal" },
  ];

  const firewallColumnsMikrotik = [
    { header: "Chain", className: mono, cell: (r) => r.chain },
    { header: "Akcija", className: "text-slate-300", cell: (r) => <ActionChip value={r.action} /> },
    { header: "Protokol : Port", className: "font-mono text-slate-400", cell: (r) => `${r.protocol || "any"}${r["dst-port"] ? `:${r["dst-port"]}` : ""}` },
    { header: "Src → Dst", className: "font-mono text-slate-400", cell: (r) => `${r["src-address"] || "any"} → ${r["dst-address"] || "any"}` },
    { header: "Komentar", cell: (r) => r.comment || "-" },
  ];
  const firewallColumnsCisco = [
    { header: "ACL", className: mono, cell: (r) => r.acl_name },
    { header: "#", className: "font-mono text-slate-500", cell: (r) => r.sequence },
    { header: "Akcija", className: "text-slate-300", cell: (r) => <ActionChip value={r.action} /> },
    { header: "Pravilo", className: "font-mono text-slate-300", cell: (r) => r.rule },
  ];

  // ---- Render ---------------------------------------------------------------
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-lg">
      <div className="flex justify-between items-center border-b border-slate-700 pb-3 mb-4">
        <div className="flex gap-4 items-center">
          <div className="flex gap-2 border-r border-slate-700 pr-4">
            <button onClick={() => setActiveConfigModule("dhcp")} className={`pb-1 text-sm font-semibold flex items-center gap-2 border-b-2 ${activeConfigModule === "dhcp" ? "border-blue-500 text-blue-400" : "border-transparent text-slate-400"}`}><Server className="w-4 h-4" /> DHCP</button>
            <button onClick={() => setActiveConfigModule("vlan")} className={`pb-1 text-sm font-semibold flex items-center gap-2 border-b-2 ${activeConfigModule === "vlan" ? "border-blue-500 text-blue-400" : "border-transparent text-slate-400"}`}><Layers className="w-4 h-4" /> VLAN</button>
            <button onClick={() => setActiveConfigModule("firewall")} className={`pb-1 text-sm font-semibold flex items-center gap-2 border-b-2 ${activeConfigModule === "firewall" ? "border-blue-500 text-blue-400" : "border-transparent text-slate-400"}`}><Shield className="w-4 h-4" /> Firewall</button>
          </div>
          <span className={`px-2 py-0.5 rounded text-xs font-bold ${isCisco ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"}`}>
            Režim: {isCisco ? "Cisco IOS CLI" : "MikroTik RouterOS"}
          </span>
        </div>
        {deviceId && (
          <button onClick={loadModuleData} disabled={loading} className="p-1.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-300" aria-label="Osvježi">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-blue-400" : ""}`} />
          </button>
        )}
      </div>

      {!deviceId ? (
        <div className="text-center py-12 text-slate-500 text-sm">Molimo izaberite uređaj sa lijeve strane.</div>
      ) : (
        <div className="space-y-6">
          {errorMsg && <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg text-xs flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> <span className="break-words min-w-0">{errorMsg}</span></div>}
          {notice && <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-lg text-xs flex items-center gap-2"><CheckCircle2 className="w-4 h-4 shrink-0" /> <span className="break-words min-w-0">{notice}</span></div>}

          {/* DHCP MODUL */}
          {activeConfigModule === "dhcp" && (
            <div className="space-y-6">
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">DHCP Pools</h4>
                {isCisco ? (
                  <form onSubmit={handleAddPool} className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <input type="text" placeholder="Ime poola" required value={newPoolCisco.name} onChange={e => setNewPoolCisco({...newPoolCisco, name: e.target.value})} className={inputCls} />
                    <input type="text" placeholder="IP mreže" required value={newPoolCisco.network} onChange={e => setNewPoolCisco({...newPoolCisco, network: e.target.value})} className={monoInputCls} />
                    <input type="text" placeholder="Subnet maska" required value={newPoolCisco.mask} onChange={e => setNewPoolCisco({...newPoolCisco, mask: e.target.value})} className={monoInputCls} />
                    <button type="submit" disabled={busy} className={btnPrimaryCls}><Plus className="w-3.5 h-3.5"/> Dodaj Pool</button>
                  </form>
                ) : (
                  <form onSubmit={handleAddPool} className="flex gap-2">
                    <input type="text" placeholder="Naziv pool-a" required value={newPoolMikrotik.name} onChange={e => setNewPoolMikrotik({...newPoolMikrotik, name: e.target.value})} className={`${inputCls} flex-1`} />
                    <input type="text" placeholder="Opsezi" required value={newPoolMikrotik.ranges} onChange={e => setNewPoolMikrotik({...newPoolMikrotik, ranges: e.target.value})} className={`${monoInputCls} flex-1`} />
                    <button type="submit" disabled={busy} className={`${btnPrimaryCls} px-3`}><Plus className="w-3.5 h-3.5"/> Dodaj Pool</button>
                  </form>
                )}

                {isCisco && isRawOutput(dhcpPools) ? (
                  <RawCliBox title="Cisco DHCP Pools Output" data={dhcpPools} />
                ) : (
                  <DataTable
                    columns={isCisco ? poolColumnsCisco : poolColumnsMikrotik}
                    rows={dhcpPools}
                    busy={busy}
                    onDelete={(p) => handleDeletePool(p.name || p[".id"])}
                    emptyText="Nema DHCP pool-ova."
                  />
                )}
              </div>

              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">DHCP Leases / Bindings</h4>
                <form onSubmit={handleAddLease} className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <input type="text" placeholder="IP adresa" required value={newLease.ip} onChange={e => setNewLease({...newLease, ip: e.target.value})} className={monoInputCls} />
                  <input type="text" placeholder="MAC adresa" required value={newLease.mac} onChange={e => setNewLease({...newLease, mac: e.target.value})} className={monoInputCls} />
                  <input type="text" placeholder="Komentar / hostname" value={newLease.comment} onChange={e => setNewLease({...newLease, comment: e.target.value})} className={inputCls} />
                  <button type="submit" disabled={busy} className={btnPrimaryCls}><Plus className="w-3.5 h-3.5"/> Dodaj Rezervaciju</button>
                </form>
                {isCisco && (
                  <p className="text-[11px] text-slate-500">
                    Na Cisco uređaju se rezervacija kreira kao zaseban pool (STATIC_...), pa se briše u tabeli DHCP pool-ova. Ovdje se brišu aktivni bindinzi.
                  </p>
                )}

                {isCisco && isRawOutput(dhcpLeases) ? (
                  <RawCliBox title="Cisco DHCP Bindings Output" data={dhcpLeases} />
                ) : (
                  <DataTable
                    columns={isCisco ? leaseColumnsCisco : leaseColumnsMikrotik}
                    rows={dhcpLeases}
                    busy={busy}
                    onDelete={(l) => {
                      const id = isCisco ? l.ip_address : (l[".id"] || l.address || l.ip || l.index);
                      handleDeleteLease(id);
                    }}
                    emptyText="Nema DHCP zapisa."
                  />
                )}
              </div>
            </div>
          )}

          {/* VLAN MODUL */}
          {activeConfigModule === "vlan" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">VLAN Konfiguracija</h4>
                {isCisco && vlanMode && (
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-700/60 text-slate-300 border border-slate-600/60">
                    {vlanMode === "switch" ? "Layer 2 (switch)" : "Layer 3 (ruter)"}
                  </span>
                )}
              </div>

              {!vlanMode ? (
                <div className="text-xs text-slate-500">{loading ? "Provjera tipa uređaja..." : "Tip uređaja nije poznat. Osvježite prikaz."}</div>
              ) : vlanMode === "switch" ? (
                // Layer 2: VLAN baza, samo ID i naziv
                <>
                  <form onSubmit={handleAddVlan} className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <input type="number" min="2" max="4094" placeholder="VLAN ID" required value={newVlan.vlan_id} onChange={e => setNewVlan({...newVlan, vlan_id: e.target.value})} className={monoInputCls} />
                    <input type="text" placeholder="Naziv VLAN-a" value={newVlan.name} onChange={e => setNewVlan({...newVlan, name: e.target.value})} className={inputCls} />
                    <button type="submit" disabled={busy} className={btnPrimaryCls}><Plus className="w-3.5 h-3.5"/> Kreiraj VLAN</button>
                  </form>
                  <p className="text-[11px] text-slate-500">Uređaj ima VLAN bazu (Layer 2). VLAN se kreira globalno, bez interfejsa i IP adrese.</p>
                </>
              ) : (
                // Layer 3 (Cisco ruter ili MikroTik): VLAN je pod-interface na fizičkom portu
                <>
                  <form onSubmit={handleAddVlan} className="grid grid-cols-1 md:grid-cols-5 gap-2">
                    <input type="text" placeholder={isCisco ? "Naziv (opcionalno)" : "Naziv"} required={!isCisco} value={newVlan.name} onChange={e => setNewVlan({...newVlan, name: e.target.value})} className={inputCls} />
                    <input type="number" min="1" max="4094" placeholder="VLAN ID" required value={newVlan.vlan_id} onChange={e => setNewVlan({...newVlan, vlan_id: e.target.value})} className={monoInputCls} />
                    <input type="text" placeholder={isCisco ? "Port (GigabitEthernet0/0)" : "Interface (ether1)"} required value={newVlan.interface} onChange={e => setNewVlan({...newVlan, interface: e.target.value})} className={monoInputCls} />
                    <input type="text" placeholder="IP/prefiks (192.168.10.1/24)" value={newVlan.ip_address} onChange={e => setNewVlan({...newVlan, ip_address: e.target.value})} className={monoInputCls} />
                    <button type="submit" disabled={busy} className={btnPrimaryCls}><Plus className="w-3.5 h-3.5"/> Kreiraj VLAN</button>
                  </form>
                  <p className="text-[11px] text-slate-500">
                    {isCisco
                      ? `Uređaj je Layer 3 ruter bez VLAN baze. VLAN se kreira kao pod-interface na fizičkom portu (router-on-a-stick)${newVlan.vlan_id ? `, npr. ${newVlan.interface || "GigabitEthernet0/0"}.${newVlan.vlan_id}` : ""}. IP adresa je opcionalna.`
                      : "VLAN interface se kreira na zadatom interfejsu. IP adresa je opcionalna."}
                  </p>
                </>
              )}

              {vlanMode && (
                isCisco && isRawOutput(vlans) ? (
                  <RawCliBox title="Cisco VLAN Output" data={vlans} />
                ) : vlanMode === "switch" ? (
                  <DataTable
                    columns={vlanColumnsSwitch}
                    rows={vlans}
                    busy={busy}
                    canDelete={(v) => !isProtectedCiscoVlan(v.vlan_id)}
                    onDelete={(v) => handleDeleteVlan(v.vlan_id, `VLAN ${v.vlan_id} (${v.name})`)}
                    emptyText="Nema VLAN-ova."
                  />
                ) : isCisco ? (
                  <DataTable
                    columns={vlanColumnsCiscoRouter}
                    rows={vlans}
                    busy={busy}
                    onDelete={(v) => handleDeleteVlan(v.subinterface, `pod-interface ${v.subinterface}`)}
                    emptyText="Nema VLAN pod-interface-a."
                  />
                ) : (
                  <DataTable
                    columns={vlanColumnsMikrotik}
                    rows={vlans}
                    busy={busy}
                    // MikroTik backend briše VLAN po nazivu interface-a
                    onDelete={(v) => handleDeleteVlan(v.name, `VLAN ${v.name}`)}
                    emptyText="Nema VLAN-ova."
                  />
                )
              )}
            </div>
          )}

          {/* FIREWALL MODUL */}
          {activeConfigModule === "firewall" && (
            <div className="space-y-4">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Firewall Pravila</h4>
              {isCisco ? (
                <form onSubmit={handleAddFirewallRule} className="space-y-2 bg-slate-900/60 p-3 rounded-lg border border-slate-700/50">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <input type="text" placeholder="ACL naziv/broj" required value={newRuleCisco.acl_name} onChange={e => setNewRuleCisco({...newRuleCisco, acl_name: e.target.value})} className={monoInputCls} />
                    <select value={newRuleCisco.action} onChange={e => setNewRuleCisco({...newRuleCisco, action: e.target.value})} className={inputCls}>
                      <option value="accept">Permit</option>
                      <option value="drop">Deny</option>
                    </select>
                    <select
                      value={newRuleCisco.protocol}
                      onChange={e => {
                        const protocol = e.target.value;
                        const keepPorts = ["tcp", "udp"].includes(protocol);
                        setNewRuleCisco({...newRuleCisco, protocol, src_port: keepPorts ? newRuleCisco.src_port : "", dst_port: keepPorts ? newRuleCisco.dst_port : ""});
                      }}
                      className={inputCls}
                    >
                      <option value="ip">IP</option>
                      <option value="tcp">TCP</option>
                      <option value="udp">UDP</option>
                      <option value="icmp">ICMP</option>
                    </select>
                    <input type="text" placeholder="Komentar (remark)" value={newRuleCisco.comment} onChange={e => setNewRuleCisco({...newRuleCisco, comment: e.target.value})} className={inputCls} />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <input type="text" placeholder="Source (any, 10.0.0.0/24, 10.0.0.5)" value={newRuleCisco.source} onChange={e => setNewRuleCisco({...newRuleCisco, source: e.target.value})} className={monoInputCls} />
                    <input type="text" placeholder="Src port" disabled={!ciscoPortsEnabled} value={newRuleCisco.src_port} onChange={e => setNewRuleCisco({...newRuleCisco, src_port: e.target.value})} className={monoInputCls} />
                    <input type="text" placeholder="Destination (any, 10.0.0.0/24, 10.0.0.5)" value={newRuleCisco.destination} onChange={e => setNewRuleCisco({...newRuleCisco, destination: e.target.value})} className={monoInputCls} />
                    <input type="text" placeholder="Dst port" disabled={!ciscoPortsEnabled} value={newRuleCisco.dst_port} onChange={e => setNewRuleCisco({...newRuleCisco, dst_port: e.target.value})} className={monoInputCls} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] text-slate-500">Portovi (npr. 443 ili 8000-8010) su dostupni samo za TCP i UDP. Kreirano pravilo djeluje tek kad se ACL primijeni na interface.</p>
                    <button type="submit" disabled={busy} className={`${btnPrimaryCls} px-3 shrink-0`}><Plus className="w-3.5 h-3.5"/> Dodaj ACL pravilo</button>
                  </div>
                </form>
              ) : (
                /*<form onSubmit={handleAddFirewallRule} className="space-y-2 bg-slate-900/60 p-3 rounded-lg border border-slate-700/50">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <select value={newRuleMikrotik.chain} onChange={e => setNewRuleMikrotik({...newRuleMikrotik, chain: e.target.value})} className={inputCls}>
                      <option value="input">Chain: input</option>
                      <option value="forward">Chain: forward</option>
                      <option value="output">Chain: output</option>
                    </select>
                    <select value={newRuleMikrotik.action} onChange={e => setNewRuleMikrotik({...newRuleMikrotik, action: e.target.value})} className={inputCls}>
                      <option value="accept">Action: accept</option>
                      <option value="drop">Action: drop</option>
                    </select>
                    <input type="text" placeholder="Protokol" value={newRuleMikrotik.protocol} onChange={e => setNewRuleMikrotik({...newRuleMikrotik, protocol: e.target.value})} className={monoInputCls} />
                    <input type="text" placeholder="Komentar" value={newRuleMikrotik.comment} onChange={e => setNewRuleMikrotik({...newRuleMikrotik, comment: e.target.value})} className={inputCls} />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    <input type="text" placeholder="Src Address" value={newRuleMikrotik.src_address} onChange={e => setNewRuleMikrotik({...newRuleMikrotik, src_address: e.target.value})} className={monoInputCls} />
                    <input type="text" placeholder="Dst Address" value={newRuleMikrotik.dst_address} onChange={e => setNewRuleMikrotik({...newRuleMikrotik, dst_address: e.target.value})} className={monoInputCls} />
                    <input type="text" placeholder="Src Port" value={newRuleMikrotik.src_port} onChange={e => setNewRuleMikrotik({...newRuleMikrotik, src_port: e.target.value})} className={monoInputCls} />
                    <input type="text" placeholder="Dst Port" value={newRuleMikrotik.dst_port} onChange={e => setNewRuleMikrotik({...newRuleMikrotik, dst_port: e.target.value})} className={monoInputCls} />
                    <button type="submit" disabled={busy} className={btnPrimaryCls}><Plus className="w-3.5 h-3.5"/> Dodaj Pravilo</button>
                  </div>
                </form>*/

                
                <form onSubmit={handleAddFirewallRule} className="space-y-2 bg-slate-900/60 p-3 rounded-lg border border-slate-700/50">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <select value={newRuleMikrotik.chain} onChange={e => setNewRuleMikrotik({...newRuleMikrotik, chain: e.target.value})} className={inputCls}>
                      <option value="input">Chain: input</option>
                      <option value="forward">Chain: forward</option>
                      <option value="output">Chain: output</option>
                    </select>
                    <select value={newRuleMikrotik.action} onChange={e => setNewRuleMikrotik({...newRuleMikrotik, action: e.target.value})} className={inputCls}>
                      <option value="accept">Action: accept</option>
                      <option value="drop">Action: drop</option>
                    </select>
                    {/* DROPDOWN ZA PROTOKOL */}
                    <select 
                      value={newRuleMikrotik.protocol} 
                      onChange={e => setNewRuleMikrotik({...newRuleMikrotik, protocol: e.target.value})} 
                      className={inputCls}
                    >
                      <option value="">Protokol (Sve / Any)</option>
                      <option value="tcp">tcp</option>
                      <option value="udp">udp</option>
                      <option value="icmp">icmp</option>
                    </select>
                    <input type="text" placeholder="Komentar" value={newRuleMikrotik.comment} onChange={e => setNewRuleMikrotik({...newRuleMikrotik, comment: e.target.value})} className={inputCls} />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    <input type="text" placeholder="Src Address (npr. 10.0.0.1 ili IP/CIDR)" value={newRuleMikrotik.src_address} onChange={e => setNewRuleMikrotik({...newRuleMikrotik, src_address: e.target.value})} className={monoInputCls} />
                    <input type="text" placeholder="Dst Address (npr. 192.168.1.0/24)" value={newRuleMikrotik.dst_address} onChange={e => setNewRuleMikrotik({...newRuleMikrotik, dst_address: e.target.value})} className={monoInputCls} />
                    <input type="text" placeholder="Src Port" value={newRuleMikrotik.src_port} onChange={e => setNewRuleMikrotik({...newRuleMikrotik, src_port: e.target.value})} className={monoInputCls} />
                    <input type="text" placeholder="Dst Port" value={newRuleMikrotik.dst_port} onChange={e => setNewRuleMikrotik({...newRuleMikrotik, dst_port: e.target.value})} className={monoInputCls} />
                    <button type="submit" disabled={busy} className={btnPrimaryCls}><Plus className="w-3.5 h-3.5"/> Dodaj pravilo</button>
                  </div>
                </form>
              )}


              {isCisco && isRawOutput(firewallRules) ? (
                <RawCliBox title="Cisco Firewall / ACL Output" data={firewallRules} />
              ) : isCisco ? (
                <DataTable
                  columns={firewallColumnsCisco}
                  rows={firewallRules}
                  busy={busy}
                  onDelete={(r) => handleDeleteFirewallRule(r.id, `pravilo ${r.sequence} iz ACL-a ${r.acl_name}`)}
                  emptyText="Nema ACL pravila."
                />
              ) : (
                <DataTable
                  columns={firewallColumnsMikrotik}
                  rows={firewallRules}
                  busy={busy}
                  onDelete={(r) => handleDeleteFirewallRule(r[".id"] || r.index, `firewall pravilo (${r.chain}, ${r.action})`)}
                  emptyText="Nema firewall pravila."
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
