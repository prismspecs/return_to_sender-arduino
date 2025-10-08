#!/usr/bin/env python3

import serial
import time

# Serial connection settings
SERIAL_PORT = '/dev/ttyACM0'
BAUD_RATE = 115200

def main():
    try:
        # Connect to Arduino
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        time.sleep(2)  # Wait for Arduino to initialize
        print(f"Connected to Arduino on {SERIAL_PORT}")

        # Set "Home" position
        ser.write(b"H\n")
        time.sleep(1)  # Wait for homing to complete
        print("Homing complete.")
        
        # Movement sequence: (time_seconds, position)
        movements = [
            (0, 0),
            (2, 1200),
            (3, 800),
            (6, 1000),
            (9, 200),
            (12, 0)
        ]
        
        print("Starting movement sequence...")
        
        while True:
            start_time = time.time()
            
            for move_time, position in movements:
                # Wait until it's time for this movement
                while (time.time() - start_time) < move_time:
                    time.sleep(0.01)  # Small delay to prevent busy waiting
                
                # Send move command (Y-axis movement, others stay at 0)
                command = f"M 0 {position} 0 0\n"
                ser.write(command.encode())
                print(f"Time {move_time}s: Moving to position {position}")
                
                # Read response from Arduino
                if ser.in_waiting > 0:
                    response = ser.readline().decode().strip()
                    if response:
                        print(f"Arduino: {response}")
            
            print("Cycle complete, restarting...\n")
            
    except serial.SerialException as e:
        print(f"Serial error: {e}")
    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        if 'ser' in locals() and ser.is_open:
            ser.close()
            print("Serial connection closed.")

if __name__ == "__main__":
    main()