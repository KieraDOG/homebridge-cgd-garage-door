# Homebridge Centurion Garage Doors

This is a Homebridge plugin that allows you to control Centurion Garage Doors.

## Features

- Open and close your Centurion Garage Door
- Monitor the status of your garage door
- Control the Lock Mode
- Turn the lights on and off
- Integrates seamlessly with Homebridge

## Configuration

Add the following to your Homebridge config.json:

```json
{
    "name": "homebridge-cgd-garage-door",
    "platform": "CGDGarageDoor",
    "deviceHostname": "<DEVICE_HOSTNAME>",
    "deviceLocalKey": "<DEVICE_LOCAL_KEY>",
}
```

You can find the deviceHostname and deviceLocalKey in the Local API section of the [MY CGD SMARTPHONE APP](https://www.cgdoors.com.au/garage-door-smartphone-app/).
