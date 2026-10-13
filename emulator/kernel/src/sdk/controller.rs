//! V5 Controller

use crate::sync::Mutex;
use vex_sdk::*;
use vex_v5_qemu_protocol::controller::{ControllerData, ControllerId};

pub static CONTROLLERS: Mutex<[Option<ControllerData>; 2]> = Mutex::new([None, None]);

pub fn update_controller(id: ControllerId, data: ControllerData) {
    let index = match id {
        ControllerId::Master => 0,
        ControllerId::Partner => 1,
    };
    CONTROLLERS.lock()[index] = Some(data);
}

pub extern "C" fn vexControllerGet(id: V5_ControllerId, index: V5_ControllerIndex) -> i32 {
    CONTROLLERS
        .lock()
        .get(id.0 as usize)
        .and_then(|data| *data)
        .map_or(0, |data| data.sdk_value(index.0))
}
pub extern "C" fn vexControllerConnectionStatusGet(id: V5_ControllerId) -> V5_ControllerStatus {
    if CONTROLLERS
        .lock()
        .get(id.0 as usize)
        .and_then(|data| *data)
        .is_some_and(|data| data.connected())
    {
        V5_ControllerStatus::kV5ControllerTethered
    } else {
        V5_ControllerStatus::kV5ControllerOffline
    }
}
pub extern "C" fn vexControllerTextSet(id: u32, line: u32, col: u32, buf: *const u8) -> u32 {
    Default::default()
}
