import { SerialPort } from 'serialport';

console.log('Checking available serial ports...\n');

SerialPort.list().then(ports => {
  if (ports.length === 0) {
    console.log('No serial ports found!');
    return;
  }

  console.log('Available ports:');
  ports.forEach((port, index) => {
    console.log(`\n${index + 1}. ${port.path}`);
    if (port.manufacturer) console.log(`   Manufacturer: ${port.manufacturer}`);
    if (port.serialNumber) console.log(`   Serial Number: ${port.serialNumber}`);
    if (port.pnpId) console.log(`   PnP ID: ${port.pnpId}`);
    if (port.vendorId) console.log(`   Vendor ID: ${port.vendorId}`);
    if (port.productId) console.log(`   Product ID: ${port.productId}`);
  });

  console.log('\n\nTroubleshooting tips:');
  console.log('1. If you see "Permission denied", run:');
  console.log('   sudo usermod -a -G dialout $USER');
  console.log('   Then log out and log back in');
  console.log('\n2. Close Arduino IDE serial monitor if open');
  console.log('\n3. Update SERIAL_PORT in server.js to match one of the paths above');
}).catch(err => {
  console.error('Error listing ports:', err);
});

