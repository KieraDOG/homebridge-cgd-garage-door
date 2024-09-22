# Homebridge Centurion Garage Doors

[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=for-the-badge&logoColor=%23FFFFFF&logo=homebridge)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)


[![Publish](https://github.com/KieraDOG/homebridge-cgd-garage-door/actions/workflows/publish.yml/badge.svg)](https://github.com/KieraDOG/homebridge-cgd-garage-door/actions/workflows/publish.yml)
[![npm](https://img.shields.io/npm/v/homebridge-cgd-garage-door/latest?label=latest)](https://www.npmjs.com/package/homebridge-cgd-garage-door)
[![MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![semantic-release](https://img.shields.io/badge/semantic--release-e10079?logo=semantic-release)](https://github.com/semantic-release/semantic-release)


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
