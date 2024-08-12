import { Logging } from 'homebridge';
import http from 'http';
import parseDoorState, { DoorState } from './parseDoorState';
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

  private run = async ({
    cmd, value,
    softValue = value,
    until = async () => {
      this.log.debug('Running without until...');
      return true;
    },
  }) => {
    this.log.debug(`Setting ${cmd} to ${softValue}`);
    let oldStatus: Status;

    if (this.status?.[cmd]) {
      oldStatus = { ...this.status };
      this.status[cmd] = softValue;

      if (!this.isStatusEqual(oldStatus)) {
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
    }, until, {
      retries: 3,
      onRetry: (error, retries) => {
        this.log.warn(`Failed to run command [${retries} retries]: ${cmd}=${value}`);
        if (error instanceof Error) {
          this.log.warn(`Error: ${error.message}`);
        }
      },
      onRecover: (retries) => {
        this.log.info(`Recovered to run command [${retries} retries]: ${cmd}=${value}`);
      },
      onFail: (error) => {
        this.log.error(`Failed to run command: ${cmd}=${value}`);
        if (error instanceof Error) {
          this.log.error(`Error: ${error.message}`);
        }

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

    this.isUpdating = false;
    this.log.debug('Updating is finished');
  };

  private until = (fn: (status: Status) => boolean) => async (): Promise<boolean> => {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const status = await this.getStatus();
    this.log.debug(`Checking status... ${JSON.stringify(status)}`);

    return !!status && fn(status);
  };

  private getStatus = async (): Promise<Status | undefined> => {
    this.log.debug('Getting status...');

    const data = await this.run({
      cmd: 'status', value: 'json',
      softValue: (new Date()).toLocaleString(),
    });

    if (!data) {
      this.log.error('Can not get status!');

      return;
    }

    return data as Status;
  };

  private refreshStatus = async () => {
    this.log.debug(`Refreshing status... ${this.isUpdating}`);
    if (this.isUpdating) {
      this.log.debug('Skip refreshing status because it is updating');

      return;
    }

    const status = await this.getStatus();
    if (this.isStatusEqual(status)) {
      this.log.debug('Skip updating status because it is equal');
      return;
    }

    if (this.isUpdating) {
      this.log.info('Skip updating status because it is updating');
      return;
    }

    this.status = status;
    this.statusUpdateListener?.();
  };

  private isStatusEqual = (data?: Status) => {
    const values = ['lamp', 'door', 'vacation'];
    return values.every((value) => this.status?.[value] === data?.[value]);
  };

  private poolStatus = async () => {
    await this.refreshStatus();
    setTimeout(this.poolStatus, 5000);
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
    const doorState = parseDoorState(this.status?.door);

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
    const doorState = parseDoorState(this.status?.door);

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
        await this.run({
          cmd: 'door', value: 'open',
          softValue: 'Opening',
          until: this.until((status) => [DoorState.Opened, DoorState.Opening, DoorState.Stopped].includes(parseDoorState(status.door))),
        });
        this.log.debug('Opened door!');
      }

      if (value === 1) {
        this.log.debug('Closing door...');
        await this.run({
          cmd: 'door', value: 'close',
          softValue: 'Closing',
          until: this.until((status) => [DoorState.Closed, DoorState.Closing, DoorState.Stopped].includes(parseDoorState(status.door))),
        });
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
        await this.run({
          cmd: 'lamp', value: 'on',
          until: this.until((status) => status.lamp === 'on'),
        });
        this.log.debug('Turned on lightbulb!');
      }

      if (!value) {
        this.log.debug('Turning off lightbulb...');
        await this.run({
          cmd: 'lamp', value: 'off',
          until: this.until((status) => status.lamp === 'off'),
        });
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
        await this.run({
          cmd: 'vacation', value: 'on',
          until: this.until((status) => status.vacation === 'on'),
        });
        this.log.debug('Turned on vacation!');
      }

      if (!value) {
        this.log.debug('Turning off vacation...');
        await this.run({
          cmd: 'vacation', value: 'off',
          until: this.until((status) => status.vacation === 'off'),
        });
        this.log.debug('Turned off vacation!');
      }
    });
  };
}
