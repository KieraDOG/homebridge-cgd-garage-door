import axios, { AxiosInstance } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import ffmpegPath from 'ffmpeg-for-homebridge';
import ffmpeg from 'fluent-ffmpeg';
import {
  Logging,
} from 'homebridge';
import tough from 'tough-cookie';

ffmpeg.setFfmpegPath(ffmpegPath || 'ffmpeg');

const cookieJar = new tough.CookieJar();

interface Device {
  name: string;
  data: {
    opener: any;
  };
}

interface Credential {
  email: string;
  password: string;
}

export class CGDStreaming {
  private readonly log: Logging;

  private credential: Credential;
  private instance: AxiosInstance;
  private isInit: boolean;

  device?: Device;

  constructor(log: Logging) {
    this.log = log;

    this.credential = {
      email: 'zlong@outlook.com',
      password: 'wangnaijia093X',
    };

    this.instance = this.getInstance();
    this.isInit = false;
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
    this.log.debug('Logged in!');
  };

  private getDevice = async (): Promise<Device> => {
    this.log.debug('Getting device...');
    const response = await this.instance.get('/api.php?do=get_dev');
    const name = Object.keys(response.data)[0];
    this.log.debug(`Got device! ${name}`);

    return {
      name,
      data: response.data[name].data.opener,
    };
  };

  public getStream = async (): Promise<any> => {
    this.log.debug('Getting data...');
    if (!this.isInit) {
      this.log.debug('Not initialized, initializing...');
      this.init();
    }

    const response = await this.instance.get(`/api.php?do=camvs&mac=${this.device!.name}&t=${new Date().getTime()}`, {
      responseType: 'stream',
    });

    this.log.debug('Got data!');

    const stream = response.data;
    return stream;
  };

  public init = async (): Promise<void> => {
    this.log.debug('Initializing...');
    await this.login();
    this.device = await this.getDevice();
    this.isInit = true;
    this.log.debug('Initialized!');
  };
}
