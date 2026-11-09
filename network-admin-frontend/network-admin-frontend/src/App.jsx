import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import NetworkScanner from './components/NetworkScanner';
import ManagedDevicesList from './components/ManagedDevicesList';
import RouterConfig from './components/RouterConfig';

const API_BASE = "http://localhost:8000";

export default function App() {
  const [activeTab, setActiveTab] = useState("scanner");

  // State za skeniranje
  const [ipRange, setIpRange] = useState("");
  const [suggestedRange, setSuggestedRange] = useState("");
  const [devices, setDevices] = useState([]);
  const [isScanning, setIsScanning] = useState(false);

  // State za dodate SSH uređaje
  const [managedDevices, setManagedDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null); // Čuva cijeli objekat selektovanog uređaja

  useEffect(() => {
    fetchSuggestedRange();
    fetchDevices();
    fetchManagedDevices();

    // Polling za automatsko osvježavanje online/offline statusa skeniranih uređaja
    const interval = setInterval(fetchDevices, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchSuggestedRange = async () => {
    try {
      const res = await fetch(`${API_BASE}/network/suggested-range`);
      const data = await res.json();
      setSuggestedRange(data.suggested_range);
      setIpRange(data.suggested_range);
    } catch (e) {
      console.error("Greška pri dohvatanju predloženog opsega:", e);
    }
  };

  const fetchDevices = async () => {
    try {
      const res = await fetch(`${API_BASE}/devices`);
      const data = await res.json();
      setDevices(data);
    } catch (e) {
      console.error("Greška pri dohvatanju skeniranih uređaja:", e);
    }
  };

  const fetchManagedDevices = async () => {
    try {
      const res = await fetch(`${API_BASE}/managed-devices`);
      const data = await res.json();
      setManagedDevices(data);
      
      // Ako imamo uređaja, a nijedan nije izabran, postavi PRVI CIJELI OBJEKAT
      if (data.length > 0 && !selectedDevice) {
        setSelectedDevice(data[0]); 
      }
    } catch (e) {
      console.error("Greška pri dohvatanju dodatih uređaja:", e);
    }
  };

  const handleScan = async () => {
    setIsScanning(true);
    try {
      const res = await fetch(`${API_BASE}/devices/scan?ip_range=${encodeURIComponent(ipRange)}`, {
        method: "POST"
      });
      if (!res.ok) throw new Error("Neuspješno skeniranje");
      const data = await res.json();
      setDevices(data);
    } catch (e) {
      alert("Greška prilikom skeniranja mreže! Provjerite privilegije na backendu.");
    } finally {
      setIsScanning(false);
    }
  };

  const handleAddManagedDevice = async (deviceData) => {
    try {
      const res = await fetch(`${API_BASE}/managed-devices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deviceData)
      });
      if (res.ok) {
        fetchManagedDevices();
      }
    } catch (e) {
      alert("Greška pri dodavanju uređaja.");
    }
  };

  const handleDeleteManagedDevice = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/managed-devices/${id}`, { method: "DELETE" });
      if (res.ok) {
        // Ako je obrisani uređaj bio selektovan, poništi selekciju
        if (selectedDevice?.id === id) {
          setSelectedDevice(null);
        }
        fetchManagedDevices();
      }
    } catch (e) {
      alert("Greška pri brisanju uređaja.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      <Header activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        {activeTab === "scanner" && (
          <NetworkScanner 
            ipRange={ipRange}
            setIpRange={setIpRange}
            suggestedRange={suggestedRange}
            isScanning={isScanning}
            onScan={handleScan}
            devices={devices}
          />
        )}

        {activeTab === "router" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <ManagedDevicesList 
              managedDevices={managedDevices}
              selectedDevice={selectedDevice}
              setSelectedDevice={setSelectedDevice}
              onAddDevice={handleAddManagedDevice}
              onDeleteDevice={handleDeleteManagedDevice}
              apiBase={API_BASE}
            />
            <div className="lg:col-span-2">
              <RouterConfig 
                selectedDevice={selectedDevice} 
                apiBase={API_BASE} 
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}