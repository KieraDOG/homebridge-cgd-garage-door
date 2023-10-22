import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import http, {IncomingMessage, Server, ServerResponse} from 'http';
import {
  API,
  APIEvent,
  CameraControllerOptions,
  DynamicPlatformPlugin,
  HAP,
  Logging,
  PlatformAccessory,
  PlatformAccessoryEvent,
  PlatformConfig,
} from 'homebridge';
import {StreamingDelegate} from './streamingDelegate';
import { CGDStreaming } from './CGDStreaming';

export class CGDCameraPlatform implements DynamicPlatformPlugin {

  private readonly log: Logging;
  private readonly api: API;

  private requestServer?: Server;

  private readonly accessories: PlatformAccessory[] = [];

  private cgdStreaming?: CGDStreaming;

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = log;
    this.api = api;

    log.info('Example platform finished initializing!');

    api.on(APIEvent.DID_FINISH_LAUNCHING, async () => {
      log.info('Example platform did finish launching!');

      const cgdStreaming = new CGDStreaming(this.log);
      await cgdStreaming.init();

      this.cgdStreaming = cgdStreaming;

      this.addAccessory(this.cgdStreaming.device?.name || 'CGD Camera');
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log('Configuring accessory %s', accessory.displayName);

    accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
      this.log('%s identified!', accessory.displayName);
    });

    const streamingDelegate = new StreamingDelegate(this.log, this.api.hap, this.cgdStreaming!);
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

    this.accessories.push(accessory);
  }


  addAccessory(name: string) {
    this.log.info('Adding new accessory with name %s', name);

    const uuid = this.api.hap.uuid.generate(name);
    const accessory = new this.api.platformAccessory(name, uuid);

    if (this.accessories.find(accessory => accessory.UUID === uuid)) {
      this.removeAccessories();
    }

    this.configureAccessory(accessory);

    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.accessories);
  }

  removeAccessories() {
    this.log.info('Removing all accessories');

    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.accessories);
    this.accessories.splice(0, this.accessories.length);
  }
}
