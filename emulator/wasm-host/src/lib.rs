use serde::Serialize;
use vex_v5_display_simulator::{ColorTheme, DisplayRenderer, TextOptions};
use vex_v5_qemu_protocol::{
    battery::BatteryData, display::DrawCommand, DisplayCommand, HostBoundPacket, KernelBoundPacket,
};
use wasm_bindgen::prelude::*;

const MAX_PACKET: usize = 16 * 1024 * 1024;

#[derive(Serialize)]
struct Event {
    event: &'static str,
    payload: Vec<u8>,
}

/// The browser host uses exactly the same bincode packets and renderer as the
/// native host.
#[wasm_bindgen]
pub struct BrowserHost {
    pending: Vec<u8>,
    renderer: DisplayRenderer,
    frame: Option<Vec<u8>>,
}

impl Default for BrowserHost {
    fn default() -> Self {
        Self {
            pending: Vec::new(),
            renderer: DisplayRenderer::new(ColorTheme::Dark),
            frame: None,
        }
    }
}

impl BrowserHost {
    fn receive(&mut self, bytes: &[u8]) -> Result<Vec<Event>, String> {
        self.pending.extend_from_slice(bytes);
        let mut consumed = 0;
        let mut events = Vec::new();
        while self.pending.len() - consumed >= 4 {
            let size = u32::from_le_bytes(self.pending[consumed..consumed + 4].try_into().unwrap())
                as usize;
            if size > MAX_PACKET {
                self.pending.clear();
                return Err("Guest packet exceeds 16 MiB".into());
            }
            if self.pending.len() - consumed < size + 4 {
                break;
            }
            let packet = &self.pending[consumed + 4..consumed + 4 + size];
            let (packet, used): (HostBoundPacket, usize) = bincode::decode_from_slice(
                packet,
                bincode::config::standard().with_limit::<MAX_PACKET>(),
            )
            .map_err(|e| e.to_string())?;
            if used != size {
                return Err("Trailing bytes in guest packet".into());
            }
            consumed += size + 4;
            match packet {
                HostBoundPacket::UsbSerial(payload) => events.push(Event {
                    event: "brain_usb_recv",
                    payload,
                }),
                HostBoundPacket::KernelSerial(payload) => events.push(Event {
                    event: "kernel_log",
                    payload,
                }),
                HostBoundPacket::ExitRequest(code) => events.push(Event {
                    event: "brain_exit",
                    payload: code.to_le_bytes().to_vec(),
                }),
                HostBoundPacket::DisplayCommand { command } => self.display(command),
                HostBoundPacket::CodeSignature(_) | HostBoundPacket::SmartPortCommand { .. } => {}
            }
        }
        self.pending.drain(..consumed);
        Ok(events)
    }

    fn display(&mut self, command: DisplayCommand) {
        let mut explicit = false;
        match command {
            DisplayCommand::Draw { command, color, .. } => {
                self.renderer.context.foreground_color = color;
                match command {
                    DrawCommand::Fill(shape) => self.renderer.draw(shape, false),
                    DrawCommand::Stroke(shape) => self.renderer.draw(shape, true),
                    DrawCommand::Text {
                        data,
                        size,
                        font,
                        position,
                        opaque,
                        background,
                    } => {
                        self.renderer.context.background_color = background;
                        self.renderer.draw_text(
                            data,
                            position,
                            !opaque,
                            TextOptions { size, font },
                        );
                    }
                    DrawCommand::CopyBuffer {
                        top_left,
                        bottom_right,
                        stride,
                        buffer,
                    } => {
                        self.renderer.draw_buffer(
                            bytemuck::cast_slice(&buffer),
                            top_left,
                            bottom_right,
                            stride.get().into(),
                        );
                    }
                }
            }
            DisplayCommand::Erase { color, .. } => {
                self.renderer.context.background_color = color;
                self.renderer.erase();
            }
            DisplayCommand::Render => explicit = true,
            DisplayCommand::DisableDoubleBuffering => self.renderer.disable_double_buffer(),
            // The native renderer does not implement scrolling either.
            DisplayCommand::Scroll { .. } => return,
        }
        if let Some(frame) = self.renderer.render(explicit) {
            self.frame = Some(frame.data().to_vec());
        }
    }
}

#[wasm_bindgen]
impl BrowserHost {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, bytes: &[u8]) -> Result<JsValue, JsValue> {
        let events = self.receive(bytes).map_err(|e| JsValue::from_str(&e))?;
        serde_wasm_bindgen::to_value(&events).map_err(Into::into)
    }

    pub fn take_frame(&mut self) -> Option<Vec<u8>> {
        self.frame.take()
    }

    pub fn battery(&self, capacity: f64) -> Result<Vec<u8>, JsValue> {
        if !capacity.is_finite() || !(0.0..=100.0).contains(&capacity) {
            return Err(JsValue::from_str("Capacity must be between 0 and 100"));
        }
        let packet = KernelBoundPacket::BatteryUpdate {
            data: BatteryData {
                capacity,
                ..BatteryData::default()
            },
            timestamp: 0,
        };
        let data = bincode::encode_to_vec(packet, bincode::config::standard()).unwrap();
        let mut framed = (data.len() as u32).to_le_bytes().to_vec();
        framed.extend(data);
        Ok(framed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fragmented_and_consecutive_uart_packets() {
        let data = bincode::encode_to_vec(
            HostBoundPacket::UsbSerial(b"hello".to_vec()),
            bincode::config::standard(),
        )
        .unwrap();
        let mut frame = (data.len() as u32).to_le_bytes().to_vec();
        frame.extend(data);
        let mut host = BrowserHost::new();
        assert!(host.receive(&frame[..2]).unwrap().is_empty());
        assert!(host.receive(&frame[2..5]).unwrap().is_empty());
        let events = host.receive(&[&frame[5..], &frame].concat()).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].payload, b"hello");
        assert!(host.pending.is_empty());
    }

    #[test]
    fn oversized_packet_is_rejected_before_allocating_body() {
        let mut host = BrowserHost::new();
        assert!(host
            .receive(&((MAX_PACKET + 1) as u32).to_le_bytes())
            .is_err());
        assert!(host.pending.is_empty());
    }

    #[test]
    fn display_packets_produce_native_rgba_frames() {
        use vex_v5_qemu_protocol::{
            display::{Color, Shape},
            geometry::{Point2, Rect},
        };
        let command = DisplayCommand::Draw {
            command: DrawCommand::Fill(Shape::Rectangle {
                top_left: Point2 { x: 40, y: 72 },
                bottom_right: Point2 { x: 200, y: 200 },
            }),
            color: Color(0x00acd8),
            clip_region: Rect {
                top_left: Point2 { x: 0, y: 32 },
                bottom_right: Point2 { x: 480, y: 272 },
            },
        };
        let payload = bincode::encode_to_vec(
            HostBoundPacket::DisplayCommand { command },
            bincode::config::standard(),
        )
        .unwrap();
        let mut bytes = (payload.len() as u32).to_le_bytes().to_vec();
        bytes.extend(payload);
        let mut host = BrowserHost::new();
        host.receive(&bytes).unwrap();
        let frame = host.take_frame().unwrap();
        assert_eq!(frame.len(), 480 * 272 * 4);
        assert_eq!(&frame[(100 * 480 + 100) * 4..][..4], &[0, 172, 216, 255]);
        assert!(host.take_frame().is_none());
    }

    #[test]
    fn battery_update_uses_kernel_wire_format() {
        let bytes = BrowserHost::new().battery(42.0).unwrap();
        assert_eq!(
            u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize,
            bytes.len() - 4
        );
        let (packet, used): (KernelBoundPacket, usize) =
            bincode::decode_from_slice(&bytes[4..], bincode::config::standard()).unwrap();
        assert_eq!(used, bytes.len() - 4);
        assert!(
            matches!(packet, KernelBoundPacket::BatteryUpdate { data, timestamp: 0 } if data.capacity == 42.0)
        );
    }
}
