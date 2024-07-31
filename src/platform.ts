import {
  API,
  APIEvent,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformAccessoryEvent,
  PlatformConfig,
} from 'homebridge';
import { CGDGarageDoor } from './CGDGarageDoor';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

export class CGDCameraPlatform implements DynamicPlatformPlugin {
  private readonly log: Logging;
  private readonly api: API;

  private readonly accessories: PlatformAccessory[] = [];

  private cgdGarageDoor: CGDGarageDoor;
  private refreshInterval?: NodeJS.Timer;

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = log;
    this.api = api;

    log.info('Platform finished initializing!');

    const { deviceHostname, deviceLocalKey } = config;

    this.cgdGarageDoor = new CGDGarageDoor(this.log, {
      deviceHostname,
      deviceLocalKey,
    });

    api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
      this.addAccessory(deviceHostname);
    });

    api.on(APIEvent.SHUTDOWN, () => {
      this.removeAccessories();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log('Configuring accessory %s', accessory.displayName);

    accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
      this.log('%s identified!', accessory.displayName);
    });

    const information = accessory.getService(this.api.hap.Service.AccessoryInformation) || accessory.addService(this.api.hap.Service.AccessoryInformation);
    information
      .setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'CGD')
      .setCharacteristic(this.api.hap.Characteristic.Model, 'PRO Sectional Door Opener');

    const garageDoorOpener = accessory.getService(this.api.hap.Service.GarageDoorOpener) || accessory.addService(new this.api.hap.Service.GarageDoorOpener(accessory.displayName));

    garageDoorOpener.getCharacteristic(this.api.hap.Characteristic.CurrentDoorState)
      .onGet(() => this.cgdGarageDoor.getDoorCurrentState());

    garageDoorOpener.getCharacteristic(this.api.hap.Characteristic.TargetDoorState)
      .onGet(() => this.cgdGarageDoor.getDoorTargetState())
      .onSet((value) => this.cgdGarageDoor.setDoorTargetState(+value));

    const lightbulb = accessory.getService(this.api.hap.Service.Lightbulb) || accessory.addService(new this.api.hap.Service.Lightbulb(accessory.displayName));

    lightbulb.getCharacteristic(this.api.hap.Characteristic.On)
      .onGet(() => this.cgdGarageDoor.getLightbulb())
      .onSet((value) => this.cgdGarageDoor.setLightbulb(value));

    const vacationSwitch = accessory.getService(this.api.hap.Service.Switch) || accessory.addService(new this.api.hap.Service.Switch(accessory.displayName));

    vacationSwitch.getCharacteristic(this.api.hap.Characteristic.On)
      .onGet(() => this.cgdGarageDoor.getVacation())
      .onSet((value) => this.cgdGarageDoor.setVacation(value));

    this.refreshInterval = setInterval(() => {
      garageDoorOpener
        .getCharacteristic(this.api.hap.Characteristic.CurrentDoorState).updateValue(this.cgdGarageDoor.getDoorCurrentState());

      lightbulb
        .getCharacteristic(this.api.hap.Characteristic.On).updateValue(this.cgdGarageDoor.getLightbulb());

      vacationSwitch
        .getCharacteristic(this.api.hap.Characteristic.On).updateValue(this.cgdGarageDoor.getVacation());
    }, 4000);
  }

  async addAccessory(name: string) {
    await this.cgdGarageDoor.poolStatus();

    this.log.info('Adding new accessory with name %s', name);

    const uuid = this.api.hap.uuid.generate(name);

    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      this.log.info('Accessory with name %s already exists', name);

      this.configureAccessory(existingAccessory);

      return;
    }

    const accessory = new this.api.platformAccessory(name, uuid);

    this.configureAccessory(accessory);

    this.accessories.push(accessory);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.accessories);
  }

  removeAccessories() {
    this.log.info('Removing all accessories');

    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.accessories);
    this.accessories.splice(0, this.accessories.length);

    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }
}
