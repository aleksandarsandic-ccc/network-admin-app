function DeviceTable({ devices }) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="bg-gray-800 text-white">
          <th className="p-2 text-left">Hostname</th>
          <th className="p-2 text-left">IP adresa</th>
          <th className="p-2 text-left">Status</th>
        </tr>
      </thead>
      <tbody>
        {devices.map(device => (
          <tr key={device.id} className="border-b border-gray-300">
            <td className="p-2">{device.hostname}</td>
            <td className="p-2">{device.ip_address}</td>
            <td className="p-2">
              {device.status_online ? (
                <span className="text-green-600 font-semibold">Online</span>
              ) : (
                <span className="text-red-600 font-semibold">Offline</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default DeviceTable