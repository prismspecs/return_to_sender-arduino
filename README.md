# CNCshield

Arduino stepper motor controller for CNC shield with 4-axis support.

## Hardware

- Arduino Uno with CNC Shield v3
- 4x stepper drivers (A4988 or DRV8825)
- 17HE15-1504S motors (200 steps/rev)
- Enable pin: 8

### Pin Mapping
- X-axis: Step=2, Dir=5
- Y-axis: Step=3, Dir=6
- Z-axis: Step=4, Dir=7
- A-axis: Step=12, Dir=13

## Setup

### Arduino Setup

1. Install AccelStepper library
2. Upload `CNCshield.ino` to Arduino
3. Verify serial connection at 115200 baud

### Web Interface Setup

1. Install Node.js dependencies:
   ```
   npm install
   ```

2. Update serial port in `server.js` (line 13):
   ```javascript
   const SERIAL_PORT = '/dev/ttyACM0';  // Change to your port
   ```

3. Start the server:
   ```
   npm start
   ```

4. Open browser to `http://localhost:3000`

### Important: A-Axis Configuration

The 4th motor (A-axis) on CNC Shield v3 requires special attention:

1. **Install a stepper driver** in the A-axis socket (next to the Z-axis driver)
2. **Check the enable jumper** - Some CNC Shield v3 boards require you to jumper the enable pin for the A-axis driver. Look for an "EN" jumper near the A-axis driver socket.
3. **Verify driver orientation** - The driver chip should face the same direction as the other drivers
4. **Set microstepping** - Use the same jumper configuration (M0, M1, M2) as your other axes
5. **Test individually** - Use the `T 3` command to test just the A-axis motor

## Serial Commands

```
M <s1> <s2> <s3> <s4>  Move to absolute positions
R <s1> <s2> <s3> <s4>  Move relative to current positions
S <speed>              Set max speed (steps/sec)
A <accel>              Set acceleration (steps/sec²)
H                      Home (zero all positions)
T <axis>               Test individual axis (0=X, 1=Y, 2=Z, 3=A)
I                      Show system info and positions
```

Examples:
```
H              # Home all axes
T 3            # Test A-axis motor (200 steps forward and back)
M 100 0 0 0    # Move X-axis to position 100
R 0 50 0 0     # Move Y-axis 50 steps relative to current position
M 0 0 0 500    # Move A-axis to position 500
```

## Web Interface

The web interface provides:

- Real-time position tracking for all 4 axes
- Absolute and relative positioning controls
- Quick-move buttons for precise adjustments
- Speed and acceleration settings
- Live console output from Arduino
- Manual command input

All controls update motor positions immediately without typing commands.



## Testing

### Python Test Script

Run `stepper_test.py` to execute a movement sequence on Y-axis:

```bash
python3 stepper_test.py
```

Update `SERIAL_PORT` in the script to match your device.

## Troubleshooting A-Axis

If the A-axis motor is not working:

1. **Check stepper driver installation**
   - Ensure the A-axis driver is properly seated in the socket
   - Verify the driver orientation matches X, Y, Z drivers
   - Check for bent pins

2. **Verify enable jumper**
   - Most CNC Shield v3 boards have an enable jumper for the A-axis
   - This jumper is often labeled "EN" near the A-axis driver
   - Bridge this jumper if present

3. **Test the motor directly**
   - Use command `T 3` to test only the A-axis
   - If other axes work but A doesn't, it's likely a hardware issue

4. **Check wiring**
   - Verify motor connections are secure
   - Ensure motor coils are connected to the correct pins (typically 1A, 1B, 2A, 2B)
   - Try swapping the motor with a working one to isolate the issue

5. **Driver current adjustment**
   - Set the A-axis driver current (Vref) to match your motor specifications
   - For 17HE15-1504S motors, Vref should be around 0.6V (1.5A × 0.4)

6. **Pin 13 LED interference**
   - Pin 13 (A_DIR) has an onboard LED that can cause minor issues
   - This is usually not a problem but can be if you have a very sensitive driver
