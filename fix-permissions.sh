#!/bin/bash
echo "Fixing Arduino upload permissions..."

# Create a udev rule for Arduino devices (Vendor ID 2341) to allow access
echo 'SUBSYSTEMS=="usb", ATTRS{idVendor}=="2341", MODE="0666"' | sudo tee /etc/udev/rules.d/99-arduino-uno-r4.rules

# Reload rules
echo "Reloading udev rules..."
sudo udevadm control --reload-rules
sudo udevadm trigger

echo "Done! Please unplug your Arduino and plug it back in, then try uploading again."
