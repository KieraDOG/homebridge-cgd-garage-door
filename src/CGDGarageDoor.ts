import retry from 'async-retry';
import { Logging } from 'homebridge';

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

export class CGDGarageDoor {
  private readonly log: Logging;
  private config: Config;
  private status?: Status;

  constructor(log: Logging, config: Config) {
    this.log = log;
    this.config = config;
  }

  private run = ({ cmd, value, softValue = value }) => retry(async () => {
    this.log.debug(`Running command: ${cmd}=${value}`);

    const { deviceHostname, deviceLocalKey } = this.config;
    const response = await fetch(`http://${deviceHostname}/api?key=${deviceLocalKey}&${cmd}=${value}`);

    if (this.status?.[cmd]) {
      this.status[cmd] = softValue;
    }

    return response.json();
  }, {
    retries: 3,
    onRetry: (error, attempt) => {
      this.log.warn(`Attempt Running command: ${cmd}=${value}, ${attempt} failed: ${error.message}`);
    },
  });

  private refreshStatus = async () => {
    this.log.debug('Getting status...');

    const data = await this.run({ cmd: 'status', value: 'json' });

    if (!data) {
      this.log.error(`Device not found: ${JSON.stringify(data)}`);
      throw new Error('DEVICE NOT FOUND');
    }

    this.status = data;
  };

  private getDoorState = (): DoorState => {
    if (this.status?.door.startsWith('Closed')) {
      this.log.debug('Door is closed!');
      return DoorState.Closed;
    }

    if (this.status?.door.startsWith('Opened')) {
      this.log.debug('Door is opened!');
      return DoorState.Opened;
    }

    if (this.status?.door.startsWith('Closing')) {
      this.log.debug('Door is closing!');
      return DoorState.Closing;
    }

    if (this.status?.door.startsWith('Opening')) {
      this.log.debug('Door is opening!');
      return DoorState.Opening;
    }

    if (this.status?.door.startsWith('Stop')) {
      this.log.debug('Door is stopped!');
      return DoorState.Stopped;
    }

    this.log.error(`[getDoorCurrentState] Unknown door status: ${this.status?.door}`);

    return DoorState.Error;
  };

  public poolStatus = async () => {
    await this.refreshStatus();

    setTimeout(this.poolStatus, 2000);
  };

  public getDoorCurrentState = (): number => {
    const doorState = this.getDoorState();

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
    }[doorState];
  };

  public getDoorTargetState = (): number => {
    const doorState = this.getDoorState();

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
    if (value === 0) {
      this.log.debug('Opening door...');
      await this.run({ cmd: 'door', value: 'open', softValue: 'Opening' });
      this.log.debug('Opened door!');

      return;
    }

    if (value === 1) {
      this.log.debug('Closing door...');
      await this.run({ cmd: 'door', value: 'close', softValue: 'Closing' });
      this.log.debug('Closed door!');

      return;
    }

    this.log.error(`[setDoorTargetState] Unknown target state: ${value}`);
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
    if (value) {
      this.log.debug('Turning on lightbulb...');
      await this.run({ cmd: 'lamp', value: 'on' });
      this.log.debug('Turned on lightbulb!');

      return;
    }

    if (!value) {
      this.log.debug('Turning off lightbulb...');
      await this.run({ cmd: 'lamp', value: 'off' });
      this.log.debug('Turned off lightbulb!');

      return;
    }

    this.log.error(`[setLightbulb] Unknown value: ${value}`);
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
    if (value) {
      this.log.debug('Turning on vacation...');
      await this.run({ cmd: 'vacation', value: 'on' });
      this.log.debug('Turned on vacation!');

      return;
    }

    if (!value) {
      this.log.debug('Turning off vacation...');
      await this.run({ cmd: 'vacation', value: 'off' });
      this.log.debug('Turned off vacation!');

      return;
    }

    this.log.error(`[setVacation] Unknown value: ${value}`);
  };
}
