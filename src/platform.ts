import {
  API,
  APIEvent,
  CameraControllerOptions,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformAccessoryEvent,
  PlatformConfig,
} from 'homebridge';
import { Server } from 'http';
import { CGDGarageDoor } from './CGDGarageDoor';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { StreamingDelegate } from './streamingDelegate';

export class CGDCameraPlatform implements DynamicPlatformPlugin {
  private readonly log: Logging;
  private readonly api: API;

  private requestServer?: Server;

  private readonly accessories: PlatformAccessory[] = [];

  private cgdGarageDoor?: CGDGarageDoor;

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = log;
    this.api = api;

    log.info('Example platform finished initializing!');

    const cgdGarageDoor = new CGDGarageDoor(this.log, {
      email: config.email,
      password: config.password,
    });

    this.cgdGarageDoor = cgdGarageDoor;

    api.on(APIEvent.DID_FINISH_LAUNCHING, async () => {
      log.info('Example platform did finish launching!');

      await this.cgdGarageDoor!.getDevice();

      this.removeAccessories();
      this.addAccessory(this.cgdGarageDoor!.device?.name || 'CGD Garage Door');
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log('Configuring accessory %s', accessory.displayName);

    accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
      this.log('%s identified!', accessory.displayName);
    });

    const streamingDelegate = new StreamingDelegate(this.log, this.api.hap, this.cgdGarageDoor!);
    const options: CameraControllerOptions = {
      cameraStreamCount: 2,
      delegate: streamingDelegate,

      streamingOptions: {
        supportedCryptoSuites: [this.api.hap.SRTPCryptoSuites.NONE, this.api.hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80], // NONE is not supported by iOS just there for testing with Wireshark for example
        video: {
          codec: {
            profiles: [this.api.hap.H264Profile.BASELINE, this.api.hap.H264Profile.MAIN, this.api.hap.H264Profile.HIGH],
            levels: [this.api.hap.H264Level.LEVEL3_1, this.api.hap.H264Level.LEVEL3_2, this.api.hap.H264Level.LEVEL4_0],
          },
          resolutions: [
            [1920, 1080, 30],
            [1280, 960, 30],
            [1280, 720, 30],
            [1024, 768, 30],
            [640, 480, 30],
            [640, 360, 30],
            [480, 360, 30],
            [480, 270, 30],
            [320, 240, 30],
            [320, 240, 15],
            [320, 180, 30],
          ],
        },
      },
    };

    const cameraController = new this.api.hap.CameraController(options);
    streamingDelegate.controller = cameraController;

    accessory.configureController(cameraController);

    const information = accessory.getService(this.api.hap.Service.AccessoryInformation) || accessory.addService(this.api.hap.Service.AccessoryInformation);
    information
      .setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'CGD')
      .setCharacteristic(this.api.hap.Characteristic.Model, 'PRO Sectional Door Opener');

    information
      .getCharacteristic(this.api.hap.Characteristic.SerialNumber)
      .onGet(async () => {
        if (!this.cgdGarageDoor!.device) {
          await this.cgdGarageDoor!.getDevice();
        }

        return this.cgdGarageDoor!.device!.name;
      });

    const garageDoorOpener = accessory.getService(this.api.hap.Service.GarageDoorOpener) || accessory.addService(new this.api.hap.Service.GarageDoorOpener(accessory.displayName));

    garageDoorOpener.getCharacteristic(this.api.hap.Characteristic.CurrentDoorState)
      .onGet(() => this.cgdGarageDoor!.getDoorCurrentState());

    garageDoorOpener.getCharacteristic(this.api.hap.Characteristic.TargetDoorState)
      .onGet(() => this.cgdGarageDoor!.getDoorCurrentState())
      .onSet(async (value) => {
        await this.cgdGarageDoor!.setDoorTargetState(+value);

        const updateState = setInterval(async () => {
          const currentState = await this.cgdGarageDoor!.getDoorCurrentState();
          this.log.debug(`Current state: ${currentState}, target state: ${value}`);
          garageDoorOpener.getCharacteristic(this.api.hap.Characteristic.CurrentDoorState).updateValue(currentState);

          if (currentState === +value) {
            this.log.debug('Current state matches target state, clearing interval');
            clearInterval(updateState);
          }
        }, 4000);

        setTimeout(() => {
          this.log.debug('Timeout reached, clearing interval');
          clearInterval(updateState);
        }, 60000);
      });

    this.accessories.push(accessory);
  }


  addAccessory(name: string) {
    this.log.info('Adding new accessory with name %s', name);

    const uuid = this.api.hap.uuid.generate(name);
    const accessory = new this.api.platformAccessory(name, uuid);

    this.configureAccessory(accessory);

    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.accessories);
  }

  removeAccessories() {
    this.log.info('Removing all accessories');

    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.accessories);
    this.accessories.splice(0, this.accessories.length);
  }
}
