import React from 'react';
import { Wifi, RefreshCw, Info, ExternalLink } from 'lucide-react';
import DeviceCard from './DeviceCard';

export default function NetworkScanner({ 
  ipRange, 
  setIpRange, 
  suggestedRange, 
  isScanning, 
  onScan, 
  devices 
}) {
  return (
    <div className="space-y-6">
      {/* Input & Info Box */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-lg">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Wifi className="text-blue-400" /> Skeniranje lokalne mreže
        </h2>
        
        <div className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label className="block text-xs font-semibold text-slate-400 mb-1">
              IP opseg u CIDR notaciji
            </label>
            <input 
              type="text" 
              value={ipRange}
              onChange={(e) => setIpRange(e.target.value)}
              placeholder="npr. 192.168.1.0/24"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:outline-none focus:border-blue-500 font-mono text-sm"
            />
          </div>
          <button 
            onClick={onScan}
            disabled={isScanning}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white font-medium px-6 py-2.5 rounded-lg flex items-center gap-2 transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${isScanning ? "animate-spin" : ""}`} />
            {isScanning ? "Skeniranje..." : "Skeniraj mrežu"}
          </button>
        </div>

        {/* Hyperlink napomena za CIDR */}
        <div className="mt-4 p-3 bg-slate-900/60 border border-slate-700/50 rounded-lg flex items-start gap-3 text-xs text-slate-400">
          <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div>
            Predloženi opseg <span className="text-blue-400 font-mono font-bold">{suggestedRange}</span> je izračunat na osnovu podataka sa vašeg mrežnog interfejsa.
            Ukoliko niste sigurni kako pronaći opseg ili razumjeti CIDR notaciju, pogledajte detalje putem{" "}
            <a 
              href={`https://www.google.com/search?q=${encodeURIComponent("how to find local subnet IP range and CIDR notation")}`} 
              target="_blank" 
              rel="noreferrer"
              className="text-blue-400 underline hover:text-blue-300 inline-flex items-center gap-0.5"
            >
              Google pretrage <ExternalLink className="w-3 h-3" />
            </a>.
          </div>
        </div>
      </div>

      {/* Grid kartica */}
      <div>
        <h3 className="text-md font-semibold text-slate-300 mb-3">
          Posljednje skenirani uređaji ({devices.length})
        </h3>
        
        {devices.length === 0 ? (
          <div className="bg-slate-800/50 border border-dashed border-slate-700 p-8 rounded-xl text-center text-slate-500">
            Nema prikazanih uređaja. Unesite opseg i pokrenite skeniranje iznad.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {devices.map((device) => (
              <DeviceCard key={device.mac_address} device={device} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}