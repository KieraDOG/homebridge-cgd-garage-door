import axios, { AxiosInstance } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import ffmpegPath from 'ffmpeg-for-homebridge';
import ffmpeg from 'fluent-ffmpeg';
import {
  Logging,
} from 'homebridge';
import { Stream } from 'stream';
import tough from 'tough-cookie';

ffmpeg.setFfmpegPath(ffmpegPath || 'ffmpeg');

const cookieJar = new tough.CookieJar();

enum DeviceDoorState {
  OPEN = 2270,
  OPENING = 5270,
  CLOSED = 1270,
  CLOSING = 4270,
}

interface Data {
  ds: DeviceDoorState;
  ohw: string;
  osw: string;
  wsw: string;
}

interface Device {
  name: string;
  data: Data;
}

interface Credential {
  email: string;
  password: string;
}

export class CGDGarageDoor {
  private readonly log: Logging;

  private credential: Credential;
  private instance: AxiosInstance;
  private isLoggedIn: boolean;

  device?: Device;

  constructor(log: Logging, credential: Credential) {
    this.log = log;

    this.credential = credential;

    this.instance = this.getInstance();
    this.isLoggedIn = false;
  }

  private getInstance = (): AxiosInstance => {
    const instance = axios.create({
      withCredentials: true,
      jar: cookieJar,
      baseURL: 'https://iot2superlift.krazyivan.net/iot/superlift',
    });

    return wrapper(instance);
  };

  private login = async (): Promise<void> => {
    this.log.debug('Logging in...');
    const formData = new FormData();
    formData.append('user', this.credential.email);
    formData.append('pass', this.credential.password);

    await this.instance.post('/api.php?do=login', formData);

    this.isLoggedIn = true;

    this.log.debug('Logged in!');
  };

  public getDevice = async (): Promise<void> => {
    this.log.debug('Getting device...');
    if(!this.isLoggedIn) {
      await this.login();
    }

    const response = await this.instance.get('/api.php?do=get_dev');
    const name = Object.keys(response.data)[0];
    this.log.debug(`Got device! ${name}`);

    this.device = {
      name,
      data: response.data[name].data.opener,
    };
  };

  public getDoorCurrentState = async (): Promise<number> => {
    await this.getDevice();

    const doorState = this.device!.data.ds;

    return {
      [DeviceDoorState.OPEN]: 0,
      [DeviceDoorState.CLOSED]: 1,
      [DeviceDoorState.OPENING]: 2,
      [DeviceDoorState.CLOSING]: 3,
      // TODO: STOPPED
    }[doorState];
  };

  public getDoorTargetState = async (): Promise<number> => {
    await this.getDevice();

    const doorState = this.device!.data.ds;

    return {
      [DeviceDoorState.OPEN]: 0,
      [DeviceDoorState.CLOSED]: 1,
      [DeviceDoorState.OPENING]: 0,
      [DeviceDoorState.CLOSING]: 1,
    }[doorState];
  };

  public setDoorTargetState = async (value: number): Promise<void> => {
    if (!this.device) {
      this.log.debug('Device not found, getting device...');
      await this.getDevice();
    }

    const doorState = this.device!.data.ds;

    if (value === 0) {
      if (doorState === DeviceDoorState.OPEN) {
        return;
      }

      this.log.debug('Opening door...');
      await this.instance.get(`/api.php?cmd=dev&mac=${this.device!.name}&mac_cmd=door_open`);
      this.log.debug('Opened door!');
    } else {
      if (doorState === DeviceDoorState.CLOSED) {
        return;
      }

      this.log.debug('Closing door...');
      await this.instance.get(`/api.php?cmd=dev&mac=${this.device!.name}&mac_cmd=door_close`);
      this.log.debug('Closed door!');
    }
  };

  public getStream = async (): Promise<Stream> => {
    if (!this.device) {
      this.log.debug('Device not found, getting device...');
      await this.getDevice();
    }

    const response = await this.instance.get(`/api.php?do=camvs&mac=${this.device!.name}&t=${new Date().getTime()}`, {
      responseType: 'stream',
    });

    this.log.debug('Got data!');

    const stream = response.data;

    const keepAlive = setInterval(() => this.instance.get(`/api.php?do=camv&mac=${this.device!.name}&t=${new Date().getTime()}`), 4000);

    stream.on('error', () => {
      this.log.error('Stream error!');

      clearInterval(keepAlive);
    });

    stream.on('end', () => {
      this.log.debug('Stream ended!');
      clearInterval(keepAlive);
    });

    return stream;
  };
}
