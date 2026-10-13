use serde::Serialize;
use vex_v5_display_simulator::{ColorTheme, DisplayRenderer, TextOptions};
use vex_v5_qemu_protocol::{
    battery::BatteryData,
    controller::{ControllerData, ControllerId},
    display::DrawCommand,
    distance_sensor::{DistanceObject, DistanceSensorData},
    DisplayCommand, HostBoundPacket, KernelBoundPacket, SmartPortCommand, SmartPortData,
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
                HostBoundPacket::CodeSignature(_) => events.push(Event {
                    event: "brain_ready",
                    payload: Vec::new(),
                }),
                HostBoundPacket::SmartPortCommand { port, command } => {
                    let message = match command {
                        SmartPortCommand::VelocitySet { velocity } => {
                            format!("Motor port {}: velocity target {}\r\n", port + 1, velocity)
                        }
                        SmartPortCommand::PwmSet { pwm } => {
                            format!("Motor port {}: PWM target {}\r\n", port + 1, pwm)
                        }
                        SmartPortCommand::VoltageSet { voltage } => {
                            format!("Motor port {}: voltage target {} mV\r\n", port + 1, voltage)
                        }
                    };
                    events.push(Event {
                        event: "motor_command",
                        payload: message.into_bytes(),
                    });
                }
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

    pub fn distance(
        &self,
        port: u8,
        distance: u32,
        size: u32,
        visible: bool,
        timestamp: u32,
    ) -> Result<Vec<u8>, JsValue> {
        if !(1..=21).contains(&port) || !(20..=2000).contains(&distance) || size > 400 {
            return Err(JsValue::from_str("Invalid distance sensor state"));
        }
        Ok(frame_packet(KernelBoundPacket::SmartPortUpdate {
            port_index: port - 1,
            data: SmartPortData::DistanceSensor(DistanceSensorData {
                object: visible.then_some(DistanceObject {
                    distance,
                    relative_size: size,
                    velocity: 0.0,
                    confidence: 63,
                }),
                status: 0x82,
            }),
            timestamp,
        }))
    }

    pub fn disconnect(&self, port: u8, timestamp: u32) -> Result<Vec<u8>, JsValue> {
        if !(1..=21).contains(&port) {
            return Err(JsValue::from_str("Invalid smart port"));
        }
        Ok(frame_packet(KernelBoundPacket::SmartPortUpdate {
            port_index: port - 1,
            data: SmartPortData::Disconnected,
            timestamp,
        }))
    }

    pub fn motor(&self, port: u8) -> Result<Vec<u8>, JsValue> {
        if !(1..=21).contains(&port) {
            return Err(JsValue::from_str("Invalid smart port"));
        }
        Ok(frame_packet(KernelBoundPacket::SmartPortUpdate {
            port_index: port - 1,
            data: SmartPortData::Motor,
            timestamp: 0,
        }))
    }

    pub fn controller(
        &self,
        id: u8,
        axis1: i32,
        axis2: i32,
        axis3: i32,
        axis4: i32,
        buttons: u32,
        capacity: u8,
        connected: bool,
    ) -> Result<Vec<u8>, JsValue> {
        if id > 1
            || [axis1, axis2, axis3, axis4]
                .iter()
                .any(|axis| !(-127..=127).contains(axis))
            || buttons > 4095
            || capacity > 100
        {
            return Err(JsValue::from_str("Invalid controller state"));
        }
        let data = ControllerData {
            axis_1: axis1 as i8 as u8,
            axis_2: axis2 as i8 as u8,
            axis_3: axis3 as i8 as u8,
            axis_4: axis4 as i8 as u8,
            button_l1: buttons & 1 != 0,
            button_l2: buttons & 2 != 0,
            button_r1: buttons & 4 != 0,
            button_r2: buttons & 8 != 0,
            button_up: buttons & 16 != 0,
            button_down: buttons & 32 != 0,
            button_left: buttons & 64 != 0,
            button_right: buttons & 128 != 0,
            button_x: buttons & 256 != 0,
            button_b: buttons & 512 != 0,
            button_y: buttons & 1024 != 0,
            button_a: buttons & 2048 != 0,
            button_all: buttons != 0,
            battery_capacity: capacity,
            flags: u32::from(connected),
            ..Default::default()
        };
        Ok(frame_packet(KernelBoundPacket::ControllerUpdate {
            id: if id == 0 {
                ControllerId::Master
            } else {
                ControllerId::Partner
            },
            data,
            timestamp: 0,
        }))
    }

    pub fn battery(
        &self,
        capacity: f64,
        voltage: i32,
        current: i32,
        temperature: f64,
    ) -> Result<Vec<u8>, JsValue> {
        if !capacity.is_finite() || !(0.0..=100.0).contains(&capacity) {
            return Err(JsValue::from_str("Capacity must be between 0 and 100"));
        }
        if !(0..=16000).contains(&voltage)
            || !(0..=100000).contains(&current)
            || !temperature.is_finite()
            || !(-40.0..=100.0).contains(&temperature)
        {
            return Err(JsValue::from_str("Invalid battery state"));
        }
        let packet = KernelBoundPacket::BatteryUpdate {
            data: BatteryData {
                capacity,
                voltage,
                current,
                temperature,
            },
            timestamp: 0,
        };
        let data = bincode::encode_to_vec(packet, bincode::config::standard()).unwrap();
        let mut framed = (data.len() as u32).to_le_bytes().to_vec();
        framed.extend(data);
        Ok(framed)
    }
}

fn frame_packet(packet: KernelBoundPacket) -> Vec<u8> {
    let data = bincode::encode_to_vec(packet, bincode::config::standard()).unwrap();
    let mut framed = (data.len() as u32).to_le_bytes().to_vec();
    framed.extend(data);
    framed
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
    fn distance_and_disconnect_use_kernel_wire_format() {
        let host = BrowserHost::new();
        let bytes = host.distance(21, 1250, 200, true, 17).unwrap();
        let (packet, used): (KernelBoundPacket, usize) =
            bincode::decode_from_slice(&bytes[4..], bincode::config::standard()).unwrap();
        assert_eq!(used, bytes.len() - 4);
        assert!(matches!(packet, KernelBoundPacket::SmartPortUpdate {
            port_index: 20, timestamp: 17, data: SmartPortData::DistanceSensor(data),
        } if data.object.unwrap().distance == 1250));
        let bytes = host.distance(1, 1000, 100, false, 0).unwrap();
        let (packet, _): (KernelBoundPacket, usize) =
            bincode::decode_from_slice(&bytes[4..], bincode::config::standard()).unwrap();
        assert!(matches!(packet, KernelBoundPacket::SmartPortUpdate {
            data: SmartPortData::DistanceSensor(data), ..
        } if data.object.is_none()));
        let bytes = host.disconnect(21, 18).unwrap();
        let (packet, _): (KernelBoundPacket, usize) =
            bincode::decode_from_slice(&bytes[4..], bincode::config::standard()).unwrap();
        assert!(matches!(
            packet,
            KernelBoundPacket::SmartPortUpdate {
                port_index: 20,
                data: SmartPortData::Disconnected,
                timestamp: 18,
            }
        ));
    }

    #[test]
    fn motor_connection_and_commands_are_visible_to_the_browser() {
        let bytes = BrowserHost::new().motor(21).unwrap();
        let (packet, used): (KernelBoundPacket, usize) =
            bincode::decode_from_slice(&bytes[4..], bincode::config::standard()).unwrap();
        assert_eq!(used, bytes.len() - 4);
        assert!(matches!(
            packet,
            KernelBoundPacket::SmartPortUpdate {
                port_index: 20,
                data: SmartPortData::Motor,
                timestamp: 0,
            }
        ));

        let encoded = bincode::encode_to_vec(
            HostBoundPacket::SmartPortCommand {
                port: 20,
                command: SmartPortCommand::VelocitySet { velocity: 120 },
            },
            bincode::config::standard(),
        )
        .unwrap();
        let mut framed = (encoded.len() as u32).to_le_bytes().to_vec();
        framed.extend(encoded);
        let events = BrowserHost::new().receive(&framed).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event, "motor_command");
        assert_eq!(events[0].payload, b"Motor port 21: velocity target 120\r\n");
    }

    #[test]
    fn controller_update_preserves_sdk_axes_buttons_and_identity() {
        for id in 0..=1 {
            let bytes = BrowserHost::new()
                .controller(id, -127, 127, 42, -42, 2049, 75, true)
                .unwrap();
            let (packet, _): (KernelBoundPacket, usize) =
                bincode::decode_from_slice(&bytes[4..], bincode::config::standard()).unwrap();
            let KernelBoundPacket::ControllerUpdate {
                id: received, data, ..
            } = packet
            else {
                panic!("Expected controller packet")
            };
            assert_eq!(
                received,
                if id == 0 {
                    ControllerId::Master
                } else {
                    ControllerId::Partner
                }
            );
            assert_eq!(data.sdk_value(2), -127);
            assert_eq!(data.sdk_value(17), 1);
            assert_eq!(data.sdk_value(6), 1);
            assert_eq!(data.sdk_value(22), 75);
        }
    }

    #[test]
    fn battery_update_uses_kernel_wire_format() {
        let bytes = BrowserHost::new().battery(42.0, 12500, 1500, 30.0).unwrap();
        assert_eq!(
            u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize,
            bytes.len() - 4
        );
        let (packet, used): (KernelBoundPacket, usize) =
            bincode::decode_from_slice(&bytes[4..], bincode::config::standard()).unwrap();
        assert_eq!(used, bytes.len() - 4);
        assert!(
            matches!(packet, KernelBoundPacket::BatteryUpdate { data, timestamp: 0 } if data.capacity == 42.0 && data.voltage == 12500 && data.current == 1500 && data.temperature == 30.0)
        );
    }
}
