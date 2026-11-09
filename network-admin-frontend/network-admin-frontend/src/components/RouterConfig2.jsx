import React, { useState, useEffect } from 'react';
import { Server, Layers, Shield, Trash2, RefreshCw, Plus, AlertCircle } from 'lucide-react';

// Backend (npr. Cisco driver) može vratiti null, običan string (raw ispis kad TextFSM
// nema šablon) ili objekat umjesto liste. Ovo osigurava da state UVIJEK bude niz.
const normalizeList = (data) => {
  if (Array.isArray(data)) return data;
  if (typeof data === "string" && data.trim()) return [{ raw_output: data }];
  if (data && typeof data === "object") return [data];
  return [];
};

// Red za neparsiran ispis sa uređaja
const RawRow = ({ item, cols }) => (
  <tr>
    <td colSpan={cols} className="p-2">
      <pre className="whitespace-pre-wrap font-mono text-[11px] text-slate-400">{item.raw_output}</pre>
    </td>
  </tr>
);

export default function RouterConfig({ selectedDevice, apiBase }) {
  const [activeConfigModule, setActiveConfigModule] = useState("dhcp"); // "dhcp", "vlan", "firewall"
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Podaci dohvaćeni sa rutera
  const [dhcpLeases, setDhcpLeases] = useState([]);
  const [dhcpPools, setDhcpPools] = useState([]);
  const [vlans, setVlans] = useState([]);
  const [firewallRules, setFirewallRules] = useState([]);

  // Forme za unose
  const [newLease, setNewLease] = useState({ ip: "", mac: "", comment: "" });
  const [newPool, setNewPool] = useState({ name: "", ranges: "" });
  const [newVlan, setNewVlan] = useState({ name: "", vlan_id: "", interface: "ether1" });
  const [newRule, setNewRule] = useState({ chain: "input", action: "accept", comment: "", protocol: "", src_address: "", dst_address: "", src_port: "", dst_port: "" });

  // Automatsko osvežavanje podataka pri promjeni rutera ili modula
  useEffect(() => {
    // Očisti stare podatke da tabela prethodnog uređaja ne ostane prikazana
    setDhcpLeases([]); setDhcpPools([]); setVlans([]); setFirewallRules([]);
    if (selectedDevice) {
      loadModuleData();
    }
  }, [selectedDevice, activeConfigModule]);

  const loadModuleData = async () => {
    if (!selectedDevice) return;
    setLoading(true);
    setErrorMsg("");
    try {
      if (activeConfigModule === "dhcp") {
        const [resLeases, resPools] = await Promise.all([
          fetch(`${apiBase}/dhcp/leases/${selectedDevice}`),
          fetch(`${apiBase}/dhcp/pools/${selectedDevice}`)
        ]);
        setDhcpLeases(resLeases.ok ? normalizeList(await resLeases.json()) : []);
        setDhcpPools(resPools.ok ? normalizeList(await resPools.json()) : []);
      } else if (activeConfigModule === "vlan") {
        const res = await fetch(`${apiBase}/vlans/${selectedDevice}`);
        setVlans(res.ok ? normalizeList(await res.json()) : []);
      } else if (activeConfigModule === "firewall") {
        const res = await fetch(`${apiBase}/firewall/${selectedDevice}`);
        setFirewallRules(res.ok ? normalizeList(await res.json()) : []);
      }
    } catch (err) {
      setErrorMsg("Greška pri komunikaciji sa ruterom ili backendom.");
    } finally {
      setLoading(false);
    }
  };

  // --- DHCP Handleri ---
  const handleAddLease = async (e) => {
    e.preventDefault();
    try {
      const url = `${apiBase}/dhcp/leases/${selectedDevice}?ip_address=${encodeURIComponent(newLease.ip)}&mac_address=${encodeURIComponent(newLease.mac)}&comment=${encodeURIComponent(newLease.comment)}`;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).detail);
      setNewLease({ ip: "", mac: "", comment: "" });
      loadModuleData();
    } catch (e) { alert(`Greška: ${e.message}`); }
  };

  const handleDeleteLease = async (leaseId) => {
    if (!confirm("Da li ste sigurni da želite obrisati ovu rezervaciju?")) return;
    try {
      const res = await fetch(`${apiBase}/dhcp/leases/${selectedDevice}/${encodeURIComponent(leaseId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).detail);
      loadModuleData();
    } catch (e) { alert(`Greška: ${e.message}`); }
  };

  const handleAddPool = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${apiBase}/dhcp/pools/${selectedDevice}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newPool)
      });
      if (!res.ok) throw new Error((await res.json()).detail);
      setNewPool({ name: "", ranges: "" });
      loadModuleData();
    } catch (e) { alert(`Greška: ${e.message}`); }
  };

  const handleDeletePool = async (poolName) => {
    if (!confirm("Da li ste sigurni da želite obrisati ovaj pool?")) return;
    try {
      const res = await fetch(`${apiBase}/dhcp/pools/${selectedDevice}/${encodeURIComponent(poolName)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).detail);
      loadModuleData();
    } catch (e) { alert(`Greška: ${e.message}`); }
  };

  // --- VLAN Handleri ---
  const handleAddVlan = async (e) => {
    e.preventDefault();
    try {
      const url = `${apiBase}/vlans/${selectedDevice}?name=${encodeURIComponent(newVlan.name)}&vlan_id=${newVlan.vlan_id}&interface=${encodeURIComponent(newVlan.interface)}`;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).detail);
      setNewVlan({ name: "", vlan_id: "", interface: "ether1" });
      loadModuleData();
    } catch (e) { alert(`Greška: ${e.message}`); }
  };

  const handleDeleteVlan = async (vlanName) => {
    if (!confirm("Da li ste sigurni da želite obrisati ovaj VLAN?")) return;
    try {
      const res = await fetch(`${apiBase}/vlans/${selectedDevice}/${encodeURIComponent(vlanName)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).detail);
      loadModuleData();
    } catch (e) { alert(`Greška: ${e.message}`); }
  };

  // --- Firewall Handleri ---
  const handleAddFirewallRule = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...newRule };
      // Uklanjanje praznih polja
      Object.keys(payload).forEach(key => !payload[key] && delete payload[key]);

      const res = await fetch(`${apiBase}/firewall/${selectedDevice}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error((await res.json()).detail);
      setNewRule({ chain: "input", action: "accept", comment: "", protocol: "", src_address: "", dst_address: "", src_port: "", dst_port: "" });
      loadModuleData();
    } catch (e) { alert(`Greška: ${e.message}`); }
  };

  const handleDeleteFirewallRule = async (ruleId) => {
    if (!confirm("Da li ste sigurni da želite obrisati ovo pravilo?")) return;
    try {
      const res = await fetch(`${apiBase}/firewall/${selectedDevice}/${encodeURIComponent(ruleId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).detail);
      loadModuleData();
    } catch (e) { alert(`Greška: ${e.message}`); }
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-lg">
      {/* Tabovi modula */}
      <div className="flex justify-between items-center border-b border-slate-700 pb-3 mb-4">
        <div className="flex gap-4">
          <button 
            onClick={() => setActiveConfigModule("dhcp")}
            className={`pb-2 text-sm font-semibold flex items-center gap-2 border-b-2 transition-all ${
              activeConfigModule === "dhcp" ? "border-blue-500 text-blue-400" : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Server className="w-4 h-4" /> DHCP Postavke
          </button>
          <button 
            onClick={() => setActiveConfigModule("vlan")}
            className={`pb-2 text-sm font-semibold flex items-center gap-2 border-b-2 transition-all ${
              activeConfigModule === "vlan" ? "border-blue-500 text-blue-400" : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Layers className="w-4 h-4" /> VLAN Mreže
          </button>
          <button 
            onClick={() => setActiveConfigModule("firewall")}
            className={`pb-2 text-sm font-semibold flex items-center gap-2 border-b-2 transition-all ${
              activeConfigModule === "firewall" ? "border-blue-500 text-blue-400" : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Shield className="w-4 h-4" /> Firewall Pravila
          </button>
        </div>

        {selectedDevice && (
          <button 
            onClick={loadModuleData} 
            disabled={loading}
            className="p-1.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-all"
            title="Osvježi podatke sa rutera"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-blue-400" : ""}`} />
          </button>
        )}
      </div>

      {!selectedDevice ? (
        <div className="text-center py-12 text-slate-500 text-sm">
          Molimo izaberite ili dodajte uređaj iz menija "Dodani uređaji" sa lijeve strane.
        </div>
      ) : (
        <div className="space-y-6">
          {errorMsg && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {errorMsg}
            </div>
          )}

          {/* ================= MODUL: DHCP ================= */}
          {activeConfigModule === "dhcp" && (
            <div className="space-y-6">
              {/* DHCP Pools */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">DHCP Pools (Opsezi)</h4>
                <form onSubmit={handleAddPool} className="flex gap-2">
                  <input type="text" placeholder="Naziv pool-a" required value={newPool.name} onChange={e => setNewPool({...newPool, name: e.target.value})} className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 flex-1" />
                  <input type="text" placeholder="Opsezi (npr. 192.168.1.100-192.168.1.200)" required value={newPool.ranges} onChange={e => setNewPool({...newPool, ranges: e.target.value})} className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono flex-1" />
                  <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1 shrink-0"><Plus className="w-3.5 h-3.5"/> Dodaj Pool</button>
                </form>

                <div className="bg-slate-900 border border-slate-700/60 rounded-lg overflow-hidden text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-slate-800 text-slate-400 border-b border-slate-700">
                      <tr>
                        <th className="p-2">Naziv</th>
                        <th className="p-2">Opseg Adresa</th>
                        <th className="p-2 text-right">Akcija</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {dhcpPools.length === 0 ? (
                        <tr><td colSpan="3" className="p-3 text-center text-slate-500">Nema definisanih pool-ova.</td></tr>
                      ) : (
                        dhcpPools.map((p, idx) => p.raw_output ? <RawRow key={idx} item={p} cols={3} /> : (
                          <tr key={idx} className="hover:bg-slate-800/40">
                            <td className="p-2 font-medium text-slate-200">{p.name || p.pool || p[".id"]}</td>
                            <td className="p-2 font-mono text-slate-300">{p.ranges || p.network || "-"}</td>
                            <td className="p-2 text-right">
                              <button onClick={() => handleDeletePool(p.name || p.pool || p[".id"])} className="text-rose-400 hover:text-rose-300 p-1"><Trash2 className="w-3.5 h-3.5"/></button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* DHCP Leases */}
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">DHCP Leases / Rezervacije</h4>
                <form onSubmit={handleAddLease} className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <input type="text" placeholder="IP Adresa" required value={newLease.ip} onChange={e => setNewLease({...newLease, ip: e.target.value})} className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono" />
                  <input type="text" placeholder="MAC Adresa" required value={newLease.mac} onChange={e => setNewLease({...newLease, mac: e.target.value})} className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono" />
                  <input type="text" placeholder="Komentar" value={newLease.comment} onChange={e => setNewLease({...newLease, comment: e.target.value})} className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200" />
                  <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold p-2 rounded-lg flex items-center justify-center gap-1"><Plus className="w-3.5 h-3.5"/> Dodaj Rezervaciju</button>
                </form>

                <div className="bg-slate-900 border border-slate-700/60 rounded-lg overflow-hidden text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-slate-800 text-slate-400 border-b border-slate-700">
                      <tr>
                        <th className="p-2">IP Adresa</th>
                        <th className="p-2">MAC Adresa</th>
                        <th className="p-2">Komentar</th>
                        <th className="p-2 text-right">Akcija</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {dhcpLeases.length === 0 ? (
                        <tr><td colSpan="4" className="p-3 text-center text-slate-500">Nema aktivnih lease-ova.</td></tr>
                      ) : (
                        dhcpLeases.map((l, idx) => l.raw_output ? <RawRow key={idx} item={l} cols={4} /> : (
                          <tr key={idx} className="hover:bg-slate-800/40">
                            <td className="p-2 font-mono text-slate-200">{l["address"] || l.ip || l.ip_address}</td>
                            <td className="p-2 font-mono text-slate-400">{l["mac-address"] || l.mac || l.hardware_address}</td>
                            <td className="p-2 text-slate-300">{l.comment || "-"}</td>
                            <td className="p-2 text-right">
                              <button onClick={() => handleDeleteLease(l[".id"] || l["address"] || l.ip_address)} className="text-rose-400 hover:text-rose-300 p-1"><Trash2 className="w-3.5 h-3.5"/></button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================= MODUL: VLAN ================= */}
          {activeConfigModule === "vlan" && (
            <div className="space-y-4">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">VLAN Interfejsi</h4>
              <form onSubmit={handleAddVlan} className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <input type="text" placeholder="Naziv (npr. vlan10)" required value={newVlan.name} onChange={e => setNewVlan({...newVlan, name: e.target.value})} className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200" />
                <input type="number" placeholder="VLAN ID" required value={newVlan.vlan_id} onChange={e => setNewVlan({...newVlan, vlan_id: e.target.value})} className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono" />
                <input type="text" placeholder="Parent Interface (npr. ether1)" required value={newVlan.interface} onChange={e => setNewVlan({...newVlan, interface: e.target.value})} className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono" />
                <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold p-2 rounded-lg flex items-center justify-center gap-1"><Plus className="w-3.5 h-3.5"/> Kreiraj VLAN</button>
              </form>

              <div className="bg-slate-900 border border-slate-700/60 rounded-lg overflow-hidden text-xs">
                <table className="w-full text-left">
                  <thead className="bg-slate-800 text-slate-400 border-b border-slate-700">
                    <tr>
                      <th className="p-2">Naziv</th>
                      <th className="p-2">VLAN ID</th>
                      <th className="p-2">Interfejs</th>
                      <th className="p-2 text-right">Akcija</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {vlans.length === 0 ? (
                      <tr><td colSpan="4" className="p-3 text-center text-slate-500">Nema definisanih VLAN-ova.</td></tr>
                    ) : (
                      vlans.map((v, idx) => v.raw_output ? <RawRow key={idx} item={v} cols={4} /> : (
                        <tr key={idx} className="hover:bg-slate-800/40">
                          <td className="p-2 font-medium text-slate-200">{v.name}</td>
                          <td className="p-2 font-mono text-blue-400">{v["vlan-id"] || v.vlan_id}</td>
                          <td className="p-2 font-mono text-slate-300">{v.interface}</td>
                          <td className="p-2 text-right">
                            <button onClick={() => handleDeleteVlan(v.name)} className="text-rose-400 hover:text-rose-300 p-1"><Trash2 className="w-3.5 h-3.5"/></button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ================= MODUL: FIREWALL ================= */}
          {activeConfigModule === "firewall" && (
            <div className="space-y-4">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Firewall Filter Pravila</h4>
              <form onSubmit={handleAddFirewallRule} className="space-y-2 bg-slate-900/60 p-3 rounded-lg border border-slate-700/50">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <select value={newRule.chain} onChange={e => setNewRule({...newRule, chain: e.target.value})} className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200">
                    <option value="input">Chain: input</option>
                    <option value="forward">Chain: forward</option>
                    <option value="output">Chain: output</option>
                  </select>
                  <select value={newRule.action} onChange={e => setNewRule({...newRule, action: e.target.value})} className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200">
                    <option value="accept">Action: accept</option>
                    <option value="drop">Action: drop</option>
                    <option value="reject">Action: reject</option>
                  </select>
                  <input type="text" placeholder="Protokol (npr. tcp, icmp)" value={newRule.protocol} onChange={e => setNewRule({...newRule, protocol: e.target.value})} className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono" />
                  <input type="text" placeholder="Komentar" value={newRule.comment} onChange={e => setNewRule({...newRule, comment: e.target.value})} className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200" />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <input type="text" placeholder="Src Address" value={newRule.src_address} onChange={e => setNewRule({...newRule, src_address: e.target.value})} className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono" />
                  <input type="text" placeholder="Dst Address" value={newRule.dst_address} onChange={e => setNewRule({...newRule, dst_address: e.target.value})} className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono" />
                  <input type="text" placeholder="Dst Port" value={newRule.dst_port} onChange={e => setNewRule({...newRule, dst_port: e.target.value})} className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono" />
                  <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold p-2 rounded-lg flex items-center justify-center gap-1"><Plus className="w-3.5 h-3.5"/> Dodaj Pravilo</button>
                </div>
              </form>

              <div className="bg-slate-900 border border-slate-700/60 rounded-lg overflow-hidden text-xs">
                <table className="w-full text-left">
                  <thead className="bg-slate-800 text-slate-400 border-b border-slate-700">
                    <tr>
                      <th className="p-2">Chain</th>
                      <th className="p-2">Action</th>
                      <th className="p-2">Src / Dst Address</th>
                      <th className="p-2">Komentar</th>
                      <th className="p-2 text-right">Akcija</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {firewallRules.length === 0 ? (
                      <tr><td colSpan="5" className="p-3 text-center text-slate-500">Nema definisanih firewall pravila.</td></tr>
                    ) : (
                      firewallRules.map((r, idx) => r.raw_output ? <RawRow key={idx} item={r} cols={5} /> : (
                        <tr key={idx} className="hover:bg-slate-800/40">
                          <td className="p-2 font-mono text-slate-200">{r.chain}</td>
                          <td className="p-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${r.action === "accept" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"}`}>
                              {r.action}
                            </span>
                          </td>
                          <td className="p-2 font-mono text-slate-400">
                            {r["src-address"] || "any"} &rarr; {r["dst-address"] || "any"}
                          </td>
                          <td className="p-2 text-slate-300">{r.comment || "-"}</td>
                          <td className="p-2 text-right">
                            <button onClick={() => handleDeleteFirewallRule(r[".id"])} className="text-rose-400 hover:text-rose-300 p-1"><Trash2 className="w-3.5 h-3.5"/></button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}