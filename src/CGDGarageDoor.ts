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

enum LampState {
  ON = 1,
  OFF = 0,
}

interface Data {
  ds: string;
  ohw: string;
  osw: string;
  wsw: string;
  lmp: LampState;
}

interface Device {
  name: string;
  data: Data;
}

interface Credential {
  email: string;
  password: string;
}

enum DoorState {
  Closed,
  Opened,
  Stopped,
  Closing,
  Opening,
  Error,
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

    const response = await this.instance.post('/api.php?do=login', formData);

    this.isLoggedIn = true;

    this.log.debug('Logged in!');

    const { user, msg, error } = response.data.login;

    if (error !== '0') {
      throw new Error(`[LOGIN FAILED]: ${user} - ${msg}`);
    }
  };

  public getDevice = async (): Promise<void> => {
    this.log.debug('Getting device...');
    if(!this.isLoggedIn) {
      await this.login();
    }

    const response = await this.instance.get('/api.php?do=get_dev');
    const name = Object.keys(response.data)[0];
    this.log.debug(`Got device! ${name}`);
    const data = response.data[name].data.opener;

    if (!response.data[name]?.data?.opener) {
      throw new Error(`[DEVICE NOT FOUND]: ${name}`);
    }

    this.device = {
      name,
      data,
    };
  };

  private getDoorState = async (): Promise<DoorState> => {
    await this.getDevice();

    const [doorState] = this.device!.data.ds.split('');

    if (doorState === '1') {
      this.log.debug('Door is closed!');
      return DoorState.Closed;
    }

    if (doorState === '2') {
      this.log.debug('Door is opened!');
      return DoorState.Opened;
    }

    if (doorState === '3') {
      this.log.debug('Door is stopped!');
      return DoorState.Stopped;
    }

    if (doorState === '4') {
      this.log.debug('Door is closing!');
      return DoorState.Closing;
    }

    if (doorState === '5') {
      this.log.debug('Door is opening!');
      return DoorState.Opening;
    }

    return DoorState.Error;
  };

  public getDoorCurrentState = async (): Promise<number> => {
    const doorState = await this.getDoorState();

    // static readonly OPEN = 0;
    // static readonly CLOSED = 1;
    // static readonly OPENING = 2;
    // static readonly CLOSING = 3;
    // static readonly STOPPED = 4;

    return {
      [DoorState.Opened]: 0,
      [DoorState.Closed]: 1,
      [DoorState.Opening]: 2,
      [DoorState.Closing]: 3,
      [DoorState.Stopped]: 4,
    }[doorState] || -1;
  };

  public getDoorTargetState = async (): Promise<number> => {
    const doorState = await this.getDoorState();

    // static readonly OPEN = 0;
    // static readonly CLOSED = 1;

    return {
      [DoorState.Opened]: 0,
      [DoorState.Opening]: 0,
      [DoorState.Stopped]: 0,
      [DoorState.Closed]: 1,
      [DoorState.Closing]: 1,
    }[doorState];
  };

  public setDoorTargetState = async (value: number): Promise<void> => {
    const doorState = await this.getDoorState();

    if (value === 0) {
      if (doorState === DoorState.Opened) {
        return;
      }

      this.log.debug('Opening door...');
      await this.instance.get(`/api.php?cmd=dev&mac=${this.device!.name}&mac_cmd=door_open`);
      this.log.debug('Opened door!');
    } else {
      if (doorState === DoorState.Closed) {
        return;
      }

      this.log.debug('Closing door...');
      await this.instance.get(`/api.php?cmd=dev&mac=${this.device!.name}&mac_cmd=door_close`);
      this.log.debug('Closed door!');
    }
  };

  public getLightbulb = async (): Promise<number> => {
    await this.getDevice();

    const lampState = this.device!.data.lmp;

    return {
      [LampState.ON]: 1,
      [LampState.OFF]: 0,
    }[lampState];
  };

  public setLightbulb = async (value): Promise<void> => {
    const cmd = value ? 'lamp_on' : 'lamp_off';

    this.log.debug(`Setting lightbulb to ${value ? 'on' : 'off'}...`);
    await this.instance.get(`/api.php?cmd=dev&mac=${this.device!.name}&mac_cmd=${cmd}`);
    this.log.debug(`Set lightbulb to ${value ? 'on' : 'off'}!`);
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
