export type ControlHandler = (frame: Uint8Array) => void;
export type DeliveryHandler = (bytes: Uint8Array) => void;
export type CloseHandler = (reason: string) => void;

export interface SeuratTransport {
  readonly name: 'webtransport' | 'websocket';
  readonly datagramas: boolean;
  onControl: ControlHandler | null;
  onDelivery: DeliveryHandler | null;
  onClose: CloseHandler | null;
  sendControl(frame: Uint8Array): void;
  sendMiradaDatagram(payload: Uint8Array): void;
  close(): void;
}
