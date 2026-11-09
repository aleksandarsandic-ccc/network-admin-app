import React from 'react';
import { Router } from 'lucide-react';

export default function Header({ activeTab, setActiveTab }) {
  return (
    <header className="bg-slate-800 border-b border-slate-700 p-4 px-6 flex justify-between items-center">
      <div className="flex items-center gap-3">
        <Router className="text-blue-500 w-8 h-8" />
        <h1 className="text-xl font-bold tracking-wide">LAN Control Center</h1>
      </div>
      <div className="flex gap-2">
        <button 
          onClick={() => setActiveTab("scanner")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === "scanner" ? "bg-blue-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"
          }`}
        >
          Skeniranje mreže
        </button>
        <button 
          onClick={() => setActiveTab("router")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === "router" ? "bg-blue-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"
          }`}
        >
          Konfiguracija mrežnih uređaja
        </button>
      </div>
    </header>
  );
}