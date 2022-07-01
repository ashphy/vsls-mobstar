import * as vscode from 'vscode';
import * as dayjs from 'dayjs';
import * as vsls from 'vsls';
import { Command } from './command';
import { Option } from './option';
import { UserInfo } from "vsls";
import StateMachine = require('javascript-state-machine');
import { filterNonNullOrUndefined } from './utils/collections';

export class Mobster {
    statusBarItem: vscode.StatusBarItem;
    extensionId = 'vsls-mobster';

    readonly SERVICE_NAME = 'mobtimer';

    liveshare: vsls.LiveShare | null = null;
    hostService: vsls.SharedService | null | undefined = null;
    guestService: vsls.SharedServiceProxy | null | undefined = null;

    currentTimer: NodeJS.Timeout | undefined = undefined;

    // Host manage data
    memberIndex: number = -1;

    option: Option = {
        state: 'Activated',
        members: [],
        mobTimeIntervalSec: 10
    };

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MIN_SAFE_INTEGER);
    }

    get isDriver() {
        return this.isMe(this.option.driver);
    }

    get me() {
        return this.liveshare?.session.user;
    }

    get isMobTimerHost() {
        return !!this.hostService;
    };

    isMe = (user: UserInfo | undefined) => {
        return this.me?.id === user?.id;
    };

    // State Transition
    doActivate = () => {
        this.activateExtention();

        console.log('Activated');
        this.option.state = 'Activated';
        this.sync();
    };

    doAskStart = () => {
        if (!this.liveshare) { return; }
        if (!this.liveshare.session) { return; }

        this.askStart();

        console.log('WaitStart');
        this.option.state = 'WaitStart';
        this.sync();
    };

    doNextTurn = () => {
        this.nextTurn();

        console.log('WaitDriver');
        this.option.state = 'WaitDriver';
        this.sync();
    };

    doConfirmDriver = () => {
        this.startTimer();

        console.log('TimerStarted');
        this.option.state = 'TimerStarted';
        this.sync();
    };

    doStopTimer = () => {
        console.log('Activated');
        this.option.state = 'Activated';
        this.sync();
    };
    // ----- State Transition

    async activateExtention() {
        this.statusBarItem.show();
        this.statusBarItem.text = "Mobstar";
        this.statusBarItem.command = "vsls-mobster.openMobStar";

        this.liveshare = await vsls.getApi();
        console.log('live share', this.liveshare);

        this.liveshare?.onDidChangeSession((event) => {
            console.log('onDidChangeSession', event);
            if (event.session.access === vsls.Access.None) {
                console.log('reset session');
                this.resetSession();
            } else {
                console.log('register host/guest');
                if (event.session.role === vsls.Role.Host) {
                    this.registerHost();
                } else if (event.session.role === vsls.Role.Guest) {
                    this.registerGuest();
                }
            }
        });

        this.liveshare?.onPresenceProviderRegistered((event) => {
            console.log('onPresenceProviderRegistered', event);
        });

        this.liveshare?.onDidChangePeers((event) => {
            console.log('onDidChangePeers', event, this.liveshare?.peers);
            if (this.isMobTimerHost) {
                this.reCreateMember();
            }
            console.log('Current Members', this.option.members);
        });

        if (this.liveshare?.onActivity) {
            this.liveshare.onActivity((event: any) => {
                console.log('onActivity', event);
            });
        }
    }

    askStart = () => {
        vscode.window.showInformationMessage(
            "Do you want to start the mob timer?",
            { modal: false },
            { title: "Start", isCloseAffordance: false },
            { title: "Cancel", isCloseAffordance: true }
        ).then((value) => {
            switch (value?.title) {
                case 'Start':
                    console.log('confirmed start the timer', value);
                    this.doNextTurn();
                    break;
                case 'Cancel':
                    this.doStopTimer();
                    break;
            }
        });
    };

    nextTurn = () => {
        // Pick the next driver up
        this.memberIndex++;

        if (this.memberIndex < 0) {
            this.memberIndex = 0;
        }

        if (this.option.members.length <= this.memberIndex) {
            this.memberIndex = 0;
        }

        this.option.driver = this.option.members[this.memberIndex];
        console.log('This turn is', this.option.driver);

        this.confirmingDriver();
    };

    confirmingDriver = () => {
        this.statusBarItem.text = `🛞 Waiting driver` ?? 'NULL';

        if (this.isMe(this.option.driver)) {
            this.statusBarItem.backgroundColor = '#d68111';
            vscode.window.showInformationMessage(
                "Next Driver is you!",
                { modal: false },
                { title: "Continue", isCloseAffordance: false },
                { title: "Cancel", isCloseAffordance: true }
            ).then((value) => {
                if (value?.title === 'Continue') {
                    if (this.isMobTimerHost) {
                        console.log('confirm driver', value);
                        this.doConfirmDriver();
                    } else {
                        this.notify('doConfirmDriver', {});
                    }
                }
            });
        } else {
            // Color Change
        }
    };

    startTimer = () => {
        if (!this.me) { return; };

        this.option.startTime = dayjs();
        this.syncTimer();
    };

    syncTimer = () => {
        if (this.currentTimer === undefined){
            this.currentTimer = setInterval(this.tick, 1000);
            this.statusBarItem.text = `🛞 ${this.option.driver?.displayName} ${this.option.mobTimeIntervalSec}s` ?? 'NULL';
        }
    };

    reCreateMember = () => {
        if (this.liveshare && this.liveshare?.session.user) {
            const user = this.liveshare?.session.user;
            const peerUsers = this.liveshare?.peers.map((peer) => peer.user).filter(Boolean);
            this.option.members = [user].concat(filterNonNullOrUndefined(peerUsers));
        }

        this.sync();
    };

    tick = async () => {
        // Display Timer
        const diff = dayjs().diff(this.option.startTime, "second");
        const remeins = this.option.mobTimeIntervalSec - diff;
        this.statusBarItem.text = `🛞 ${this.option.driver?.displayName} ${remeins.toString()}s` ?? 'NULL';

        // When turn change
        if (remeins <= 0) {
            if (this.currentTimer !== undefined) {
                clearInterval(this.currentTimer);
                this.currentTimer = undefined;
            }

            if (this.isMobTimerHost) {
                this.doNextTurn();
            }
        }
    };

    sync = () => {
        this.notify('sync', this.option);
    };

    onSync = (args: unknown) => {
        const oldOption = this.option;
        const newOption = args as Option;

        console.log('onSync', newOption);

        const isStateChanged = oldOption.state !== newOption.state;

        this.option = newOption;

        if (isStateChanged) {
            switch (newOption.state) {
                case 'WaitDriver':
                    this.confirmingDriver();
                    break;
                case 'TimerStarted':
                    this.syncTimer();
                default:
                    break;
            }
        }
    };

    registerHost = async () => {
        this.hostService = await this.liveshare?.shareService(this.SERVICE_NAME);
        this.hostService?.onNotify('doConfirmDriver', this.doConfirmDriver);

        if (this.me) {
            this.option.members.push(this.me);
        }
    };

    registerGuest = async () => {
        this.guestService = await this.liveshare?.getSharedService(this.SERVICE_NAME);
        if (this.guestService?.isServiceAvailable) {
            this.guestService?.onNotify('sync', this.onSync);
        } else {
            // たぶんホストに拡張が入っていない場合
            console.log('Guest service is not available');
        }
    };

    resetSession = () => {
        this.hostService = undefined;
        this.guestService = undefined;
        this.option.members = [];
    };

    notify = (cmd: string, args: any) => {
        if (this.hostService) {
            this.hostService.notify(cmd, args);
        } else if (this.guestService) {
            this.guestService.notify(cmd, args);
        }
    };
}