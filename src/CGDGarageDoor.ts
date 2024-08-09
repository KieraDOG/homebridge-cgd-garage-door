import { Logging } from 'homebridge';
import http from 'http';
import retry from './retry';

const httpAgent = new http.Agent({ keepAlive: true });

interface Status {
  lamp: 'on' | 'off';
  door: string;
  dt: string;
  vacation: 'on' | 'off';
  cycles: string;
  wdBm: string;
  error: string;
  camera: string;
  status: string;
}

interface Config {
  deviceHostname: string;
  deviceLocalKey: string;
}

enum DoorState {
  Closed,
  Opened,
  Stopped,
  Closing,
  Opening,
  Error,
}

type StatusUpdateListener = () => void;

export class CGDGarageDoor {
  private readonly log: Logging;
  private config: Config;
  private status?: Status;
  private statusUpdateListener?: StatusUpdateListener;
  private isUpdating = false;

  constructor(log: Logging, config: Config) {
    this.log = log;
    this.config = config;

    this.poolStatus();
  }

  private run = async ({ cmd, value, softValue = value }) => {
    this.log.debug(`Setting ${cmd} to ${softValue}`);
    let oldStatus: Status;

    if (this.status?.[cmd]) {
      oldStatus = { ...this.status };
      this.status[cmd] = softValue;

      if (!this.isStatusEqual(oldStatus, this.status)) {
        this.log.debug(`Updating ${cmd} to ${softValue}`);
        this.statusUpdateListener?.();
      }
    }

    return retry(async () => {
      this.log.debug(`Running command: ${cmd}=${value}`);

      const { deviceHostname, deviceLocalKey } = this.config;
      const response = await fetch(`http://${deviceHostname}/api?key=${deviceLocalKey}&${cmd}=${value}`, {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        agent: httpAgent,
      });

      const data = await response.json();

      const level = response.ok ? 'debug' : 'error';
      this.log[level](response.status.toString());
      this.log[level](JSON.stringify(data));

      if (!response.ok) {
        throw new Error(`Fetch failed with status ${response.status}, ${JSON.stringify(data)}`);
      }

      return data;
    }, {
      retries: 3,
      onRetry: (error, retries) => {
        this.log.warn(`Failed to run command [${retries} retries]: ${cmd}=${value}`);
        this.log.warn(JSON.stringify(error));
      },
      onRecover: (retries) => {
        this.log.info(`Recovered to run command [${retries} retries]: ${cmd}=${value}`);
      },
      onFail: (error) => {
        this.log.error(`Failed to run command: ${cmd}=${value}`);
        this.log.error(JSON.stringify(error));

        if (oldStatus) {
          this.log.debug(`Reverting ${cmd}`);
          this.status = oldStatus;
          this.statusUpdateListener?.();
        }
      },
    });
  };

  private withIsUpdating = async <T>(fn: () => Promise<T>): Promise<void> => {
    this.isUpdating = true;
    this.log.debug('Updating is in progress...');
    await fn();

    setTimeout(() => {
      this.isUpdating = false;
      this.log.debug('Updating is finished');
    }, 2000);
  };

  private refreshStatus = async () => {
    this.log.debug(`Refreshing status... ${this.isUpdating}`);
    if (this.isUpdating) {
      this.log.debug('Skip');

      return;
    }

    this.log.debug('Getting status...');

    const data = await this.run({ cmd: 'status', value: 'json', softValue: (new Date()).toLocaleString() });

    if (!data) {
      this.log.error('Can not get status!');

      return;
    }

    if (this.status && this.isStatusEqual(this.status, data as Status)) {
      return;
    }

    this.status = data as Status;
    this.statusUpdateListener?.();
  };

  private isStatusEqual = (a: Status, b: Status) => {
    const values = ['lamp', 'door', 'vacation'];
    return values.every((value) => a[value] === b[value]);
  };

  private poolStatus = async () => {
    await this.refreshStatus();
    setTimeout(this.poolStatus, 5000);
  };

  private getDoorState = (): DoorState => {
    if (this.status?.door.startsWith('Closed')) {
      return DoorState.Closed;
    }

    if (this.status?.door.startsWith('Opened')) {
      return DoorState.Opened;
    }

    if (this.status?.door.startsWith('Closing')) {
      return DoorState.Closing;
    }

    if (this.status?.door.startsWith('Opening')) {
      return DoorState.Opening;
    }

    if (this.status?.door.startsWith('Stop')) {
      return DoorState.Stopped;
    }

    this.log.error(`[getDoorState] Unknown door status: ${this.status?.door}`);

    return DoorState.Error;
  };

  public onStatusUpdate = (listener: StatusUpdateListener) => {
    this.statusUpdateListener = listener;
  };

  public waitForStatus = () => new Promise<void>((resolve) => {
    this.log.info('Pulse - Ping...');
    const interval = setInterval(() => {
      if (this.status) {
        this.log.info('Pulse - Pong!');
        clearInterval(interval);
        resolve();
      }
    }, 1000);
  });

  public getCurrentDoorState = (): number => {
    const doorState = this.getDoorState();

    // export declare class CurrentDoorState extends Characteristic {
    //   static readonly UUID: string;
    //   static readonly OPEN = 0;
    //   static readonly CLOSED = 1;
    //   static readonly OPENING = 2;
    //   static readonly CLOSING = 3;
    //   static readonly STOPPED = 4;
    //   constructor();
    // }

    if (doorState === DoorState.Error) {
      this.log.error(`[getDoorCurrentState] Unknown door state: ${doorState}`);
      return -1;
    }

    return {
      [DoorState.Opened]: 0,
      [DoorState.Closed]: 1,
      [DoorState.Opening]: 2,
      [DoorState.Closing]: 3,
      [DoorState.Stopped]: 4,
    }[doorState];
  };

  public getTargetDoorState = (): number => {
    const doorState = this.getDoorState();

    // export declare class TargetDoorState extends Characteristic {
    //   static readonly UUID: string;
    //   static readonly OPEN = 0;
    //   static readonly CLOSED = 1;
    //   constructor();
    // }

    if (doorState === DoorState.Error) {
      this.log.error(`[getDoorTargetState] Unknown door state: ${doorState}`);
      return -1;
    }

    return {
      [DoorState.Opened]: 0,
      [DoorState.Opening]: 0,
      [DoorState.Stopped]: 0,
      [DoorState.Closed]: 1,
      [DoorState.Closing]: 1,
    }[doorState];
  };

  public setTargetDoorState = async (value: number): Promise<void> => {
    this.withIsUpdating(async () => {
      if (value === 0) {
        this.log.debug('Opening door...');
        await this.run({ cmd: 'door', value: 'open', softValue: 'Opening' });
        this.log.debug('Opened door!');
      }

      if (value === 1) {
        this.log.debug('Closing door...');
        await this.run({ cmd: 'door', value: 'close', softValue: 'Closing' });
        this.log.debug('Closed door!');
      }
    });
  };

  public getLightbulb = (): number => {
    const lampState = this.status?.lamp;

    if (!lampState) {
      this.log.error(`[getLightbulb] Unknown lamp state: ${lampState}`);
      return -1;
    }

    return {
      on: 1,
      off: 0,
    }[lampState];
  };

  public setLightbulb = async (value): Promise<void> => {
    this.withIsUpdating(async () => {
      if (value) {
        this.log.debug('Turning on lightbulb...');
        await this.run({ cmd: 'lamp', value: 'on' });
        this.log.debug('Turned on lightbulb!');
      }

      if (!value) {
        this.log.debug('Turning off lightbulb...');
        await this.run({ cmd: 'lamp', value: 'off' });
        this.log.debug('Turned off lightbulb!');
      }
    });
  };

  public getVacation = (): number => {
    const vacationState = this.status?.vacation;

    if (!vacationState) {
      this.log.error(`[getVacation] Unknown vacation state: ${vacationState}`);
      return -1;
    }

    return {
      on: 1,
      off: 0,
    }[vacationState];
  };

  public setVacation = async (value): Promise<void> => {
    this.withIsUpdating(async () => {
      if (value) {
        this.log.debug('Turning on vacation...');
        await this.run({ cmd: 'vacation', value: 'on' });
        this.log.debug('Turned on vacation!');
      }

      if (!value) {
        this.log.debug('Turning off vacation...');
        await this.run({ cmd: 'vacation', value: 'off' });
        this.log.debug('Turned off vacation!');
      }
    });
  };
}
