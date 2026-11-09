import React, { useState } from 'react';
import { Server, Plus, Activity, CheckCircle2, XCircle, Loader2, Trash2 } from 'lucide-react';

export default function ManagedDevicesList({ 
  managedDevices, 
  selectedDevice, 
  setSelectedDevice, 
  onAddDevice,
  onDeleteDevice,
  apiBase
}) {
  const [newSSHDevice, setNewSSHDevice] = useState({
    name: "", host: "", port: 22, username: "", password: "", vendor: "mikrotik"
  });

  // Stanje za pinganje pojedinačnog rutera
  const [pingStates, setPingStates] = useState({});

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!isValidIPv4(newSSHDevice.host)) {
      alert("Molimo unesite validnu IPv4 adresu (npr. 192.168.1.1).");
      return;
    }

    onAddDevice(newSSHDevice);
    setNewSSHDevice({ name: "", host: "", port: 22, username: "", password: "", vendor: "mikrotik" });
  };
  const handlePing = async (id, host) => {
    setPingStates(prev => ({ ...prev, [id]: { loading: true, result: null } }));
    try {
      // Backend test konekcije preko DHCP leases rute ili direktnog pinga
      const res = await fetch(`${apiBase}/dhcp/leases/${id}`);
      if (res.ok) {
        setPingStates(prev => ({ ...prev, [id]: { loading: false, online: true } }));
      } else {
        setPingStates(prev => ({ ...prev, [id]: { loading: false, online: false } }));
      }
    } catch {
      setPingStates(prev => ({ ...prev, [id]: { loading: false, online: false } }));
    }
  };



  const isValidIPv4 = (ip) => {
  const regex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return regex.test(ip);
  };

// U tvom komponentu:
  const isIpValid = isValidIPv4(newSSHDevice.host);

  // Izvlačimo ID trenutno selektovanog uređaja za vizuelni highlight u listi
  const currentSelectedId = typeof selectedDevice === 'object' ? selectedDevice?.id : selectedDevice;

  return (
    <div className="space-y-6">
      {/* Forma za dodavanje SSH uređaja */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow-lg">
        <h3 className="text-md font-semibold mb-3 flex items-center gap-2 text-slate-200">
          <Server className="text-blue-400 w-5 h-5"/> Dodaj novi uređaj (SSH)
        </h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input 
            type="text" placeholder="Naziv" required
            value={newSSHDevice.name} onChange={e => setNewSSHDevice({...newSSHDevice, name: e.target.value})}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200"
          />
          <div className="grid grid-cols-3 gap-2">
            {/*<input 
              type="text" placeholder="Host / IP" required
              value={newSSHDevice.host} onChange={e => setNewSSHDevice({...newSSHDevice, host: e.target.value})}
              className="col-span-2 bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono"
            />*/}

            <input 
            type="text" 
            placeholder="Host / IP" 
            required
            value={newSSHDevice.host} 
            onChange={e => {
              const sanitizedValue = e.target.value.replace(/[^0-9.]/g, '');
              setNewSSHDevice({...newSSHDevice, host: sanitizedValue});
            }}
            className={`col-span-2 bg-slate-900 border rounded-lg p-2 text-xs text-slate-200 font-mono ${
              newSSHDevice.host && !isIpValid 
                ? 'border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500' 
                : 'border-slate-700'
            }`}
            />
        
            <input 
              type="number" placeholder="Port" required
              value={newSSHDevice.port} onChange={e => setNewSSHDevice({...newSSHDevice, port: parseInt(e.target.value) || 22})}
              className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono"
            />
          </div>
          <input 
            type="text" placeholder="Korisničko ime" required
            value={newSSHDevice.username} onChange={e => setNewSSHDevice({...newSSHDevice, username: e.target.value})}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200"
          />
          <input 
            type="password" placeholder="Lozinka" required
            value={newSSHDevice.password} onChange={e => setNewSSHDevice({...newSSHDevice, password: e.target.value})}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200"
          />
          <select 
            value={newSSHDevice.vendor} onChange={e => setNewSSHDevice({...newSSHDevice, vendor: e.target.value})}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200"
          >
            <option value="mikrotik">MikroTik RouterOS</option>
            <option value="cisco">Cisco IOS</option>
          </select>
          {/*<button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold py-2 rounded-lg flex items-center justify-center gap-1">
            <Plus className="w-4 h-4"/> Sačuvaj uređaj
          </button>*/}

          <button 
            type="submit" 
            disabled={!isValidIPv4(newSSHDevice.host)}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-xs font-semibold py-2 rounded-lg flex items-center justify-center gap-1 transition-all"
          >
            <Plus className="w-4 h-4"/> Sačuvaj uređaj
          </button>

        </form>
      </div>

      {/* Lista: Dodani uređaji sa Ping dugmetom */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 shadow-lg">
        <h4 className="text-xs font-semibold text-slate-400 mb-3 uppercase tracking-wider">
          Dodani uređaji ({managedDevices.length})
        </h4>
        
        {managedDevices.length === 0 ? (
          <div className="text-xs text-slate-500 text-center py-4">Nema unesenih uređaja.</div>
        ) : (
          <div className="space-y-2">
            {managedDevices.map(d => {
              const pingState = pingStates[d.id];
              const isSelected = currentSelectedId === d.id;

              return (
                <div 
                  key={d.id} 
                  className={`p-3 rounded-lg border transition-all flex justify-between items-center ${
                    isSelected 
                      ? "border-blue-500 bg-blue-500/10" 
                      : "border-slate-700 bg-slate-900 hover:border-slate-600"
                  }`}
                >
                  <div 
                    onClick={() => setSelectedDevice(d)} // KLJUČNA IZMJENA: Proslijeđen cijeli objekat 'd' umjesto 'd.id'
                    className="cursor-pointer flex-1"
                  >
                    <div className="text-xs font-bold text-slate-200 flex items-center gap-2">
                      {d.name}
                      {pingState && !pingState.loading && (
                        pingState.online ? (
                          <span className="text-[10px] text-emerald-400 flex items-center gap-0.5"><CheckCircle2 className="w-3 h-3"/> Dostupan</span>
                        ) : (
                          <span className="text-[10px] text-rose-400 flex items-center gap-0.5"><XCircle className="w-3 h-3"/> Nedostupan</span>
                        )
                      )}
                    </div>
                    <div className="text-[10px] font-mono text-slate-400">
                      {d.host}:{d.port} ({d.vendor || "mikrotik"})
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Ping Dugme */}
                    <button
                      title="Provjeri dostupnost"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePing(d.id, d.host);
                      }}
                      className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-600 transition-all text-xs flex items-center gap-1"
                    >
                      {pingState?.loading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                      ) : (
                        <Activity className="w-3.5 h-3.5 text-blue-400" />
                      )}
                      <span className="text-[10px]">Ping</span>
                    </button>

                    {/* Brisanje uređaja */}
                    <button
                      title="Obriši uređaj"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteDevice(d.id);
                      }}
                      className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded border border-rose-500/20 transition-all text-xs"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}