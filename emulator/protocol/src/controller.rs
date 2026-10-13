use bincode::{Decode, Encode};
#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Encode, Decode)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub enum ControllerId {
    Master,
    Partner,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Encode, Decode, Default)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct ControllerData {
    pub axis_1: u8,
    pub axis_2: u8,
    pub axis_3: u8,
    pub axis_4: u8,
    pub axis_spare_1: u8,
    pub axis_spare_2: u8,
    pub button_a: bool,
    pub button_b: bool,
    pub button_x: bool,
    pub button_y: bool,
    pub button_up: bool,
    pub button_down: bool,
    pub button_left: bool,
    pub button_right: bool,
    pub button_l1: bool,
    pub button_l2: bool,
    pub button_r1: bool,
    pub button_r2: bool,
    pub button_all: bool,
    pub button_level: bool,
    pub button_sel: bool,
    pub battery_capacity: u8,
    pub flags: u32,
}

impl ControllerData {
    /// Simulator flag bit 0 indicates an attached controller. Axis bytes carry
    /// signed two's-complement values in the SDK range -127 through 127.
    pub fn connected(&self) -> bool {
        self.flags & 1 != 0
    }

    pub fn sdk_value(&self, index: u8) -> i32 {
        if !self.connected() {
            return 0;
        }
        match index {
            0 => self.axis_4 as i8 as i32,
            1 => self.axis_3 as i8 as i32,
            2 => self.axis_1 as i8 as i32,
            3 => self.axis_2 as i8 as i32,
            4 => self.axis_spare_1 as i8 as i32,
            5 => self.axis_spare_2 as i8 as i32,
            6 => self.button_l1 as i32,
            7 => self.button_l2 as i32,
            8 => self.button_r1 as i32,
            9 => self.button_r2 as i32,
            10 => self.button_up as i32,
            11 => self.button_down as i32,
            12 => self.button_left as i32,
            13 => self.button_right as i32,
            14 => self.button_x as i32,
            15 => self.button_b as i32,
            16 => self.button_y as i32,
            17 => self.button_a as i32,
            18 => self.button_sel as i32,
            19 => self.button_level as i32,
            20 => self.button_all as i32,
            21 => self.flags as i32,
            22 => self.battery_capacity as i32,
            _ => 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sdk_axes_buttons_and_disconnect() {
        let mut data = ControllerData {
            flags: 1,
            axis_1: (-127_i8) as u8,
            axis_2: 127,
            axis_3: 42,
            axis_4: (-42_i8) as u8,
            button_a: true,
            button_l1: true,
            battery_capacity: 75,
            ..Default::default()
        };
        assert_eq!(
            (
                data.sdk_value(0),
                data.sdk_value(1),
                data.sdk_value(2),
                data.sdk_value(3)
            ),
            (-42, 42, -127, 127)
        );
        assert_eq!(data.sdk_value(6), 1);
        assert_eq!(data.sdk_value(17), 1);
        assert_eq!(data.sdk_value(22), 75);
        assert_eq!(data.sdk_value(255), 0);
        data.flags = 0;
        assert!(!data.connected());
        for index in 0..23 {
            assert_eq!(data.sdk_value(index), 0);
        }
    }
}
