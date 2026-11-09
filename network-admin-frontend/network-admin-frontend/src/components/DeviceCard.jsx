import React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';

export default function DeviceCard({ device }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:border-slate-600 transition-all">
      <div>
        <div className="flex justify-between items-start mb-2">
          <span className="font-semibold text-slate-200 truncate">
            {device.hostname || "Nepoznat host"}
          </span>
          <span className={`px-2 py-0.5 rounded text-xs font-semibold flex items-center gap-1 ${
            device.status_online 
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
              : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
          }`}>
            {device.status_online ? <CheckCircle2 className="w-3 h-3"/> : <XCircle className="w-3 h-3"/>}
            {device.status_online ? "Online" : "Offline"}
          </span>
        </div>
        <div className="space-y-1 text-xs font-mono text-slate-400">
          <div><span className="text-slate-500">IP:</span> {device.ip_address}</div>
          <div><span className="text-slate-500">MAC:</span> {device.mac_address}</div>
        </div>
      </div>
      <div className="mt-4 pt-2 border-t border-slate-700/50 flex justify-between items-center text-[11px] text-slate-400">
        <span>Vendor:</span>
        <span className="font-medium text-slate-300 truncate max-w-[150px]">{device.vendor}</span>
      </div>
    </div>
  );
}