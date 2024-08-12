export enum DoorState {
  Closed,
  Opened,
  Stopped,
  Closing,
  Opening,
  Error,
}

export default function parseDoorState(door?: string): DoorState {
  if (!door) {
    return DoorState.Error;
  }

  if (door.startsWith('Closed')) {
    return DoorState.Closed;
  }

  if (door.startsWith('Opened')) {
    return DoorState.Opened;
  }

  if (door.startsWith('Closing')) {
    return DoorState.Closing;
  }

  if (door.startsWith('Opening')) {
    return DoorState.Opening;
  }

  if (door.startsWith('Stop')) {
    return DoorState.Stopped;
  }

  return DoorState.Error;
}
