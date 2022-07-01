import dayjs = require("dayjs");
import { UserInfo } from "vsls";
import { State } from "./state";

export interface Option {
    state: State;
    driver?: UserInfo;
    members: UserInfo[];
    startTime?: dayjs.Dayjs;
    mobTimeIntervalSec: number;
}