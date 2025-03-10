import * as assert from 'assert';
import * as sinon from 'sinon';
import appInsights from '../../../../appInsights';
import auth from '../../../../Auth';
import { Logger } from '../../../../cli';
import Command, { CommandError } from '../../../../Command';
import request from '../../../../request';
import Utils from '../../../../Utils';
import commands from '../../commands';
const command: Command = require('./membersettings-list');

describe(commands.TEAMS_MEMBERSETTINGS_LIST, () => {
  let log: string[];
  let logger: Logger;
  let loggerLogSpy: sinon.SinonSpy;

  before(() => {
    sinon.stub(auth, 'restoreAuth').callsFake(() => Promise.resolve());
    sinon.stub(appInsights, 'trackEvent').callsFake(() => {});
    auth.service.connected = true;
  });

  beforeEach(() => {
    log = [];
    logger = {
      log: (msg: string) => {
        log.push(msg);
      },
      logRaw: (msg: string) => {
        log.push(msg);
      },
      logToStderr: (msg: string) => {
        log.push(msg);
      }
    };
    loggerLogSpy = sinon.spy(logger, 'log');
    (command as any).items = [];
  });

  afterEach(() => {
    Utils.restore([
      request.get
    ]);
  });

  after(() => {
    Utils.restore([
      auth.restoreAuth,
      appInsights.trackEvent
    ]);
    auth.service.connected = false;
  });

  it('has correct name', () => {
    assert.strictEqual(command.name.startsWith(commands.TEAMS_MEMBERSETTINGS_LIST), true);
  });

  it('has a description', () => {
    assert.notStrictEqual(command.description, null);
  });

  it('lists member settings for a Microsoft Team', (done) => {
    sinon.stub(request, 'get').callsFake((opts) => {
      if (opts.url === `https://graph.microsoft.com/v1.0/teams/2609af39-7775-4f94-a3dc-0dd67657e900?$select=memberSettings`) {
        return Promise.resolve({
          "memberSettings": {
            "allowCreateUpdateChannels": true,
            "allowDeleteChannels": true,
            "allowAddRemoveApps": true,
            "allowCreateUpdateRemoveTabs": true,
            "allowCreateUpdateRemoveConnectors": true
          }
        });
      }

      return Promise.reject('Invalid request');
    });

    command.action(logger, { options: { teamId: "2609af39-7775-4f94-a3dc-0dd67657e900", debug: false } }, () => {
      try {
        assert(loggerLogSpy.calledWith({
          "allowCreateUpdateChannels": true,
          "allowDeleteChannels": true,
          "allowAddRemoveApps": true,
          "allowCreateUpdateRemoveTabs": true,
          "allowCreateUpdateRemoveConnectors": true
        }));
        done();
      }
      catch (e) {
        done(e);
      }
    });
  });

  it('lists member settings for a Microsoft Team (debug)', (done) => {
    sinon.stub(request, 'get').callsFake((opts) => {
      if (opts.url === `https://graph.microsoft.com/v1.0/teams/2609af39-7775-4f94-a3dc-0dd67657e900?$select=memberSettings`) {
        return Promise.resolve({
          "memberSettings": {
            "allowCreateUpdateChannels": true,
            "allowDeleteChannels": true,
            "allowAddRemoveApps": true,
            "allowCreateUpdateRemoveTabs": true,
            "allowCreateUpdateRemoveConnectors": true
          }
        });
      }

      return Promise.reject('Invalid request');
    });

    command.action(logger, { options: { teamId: "2609af39-7775-4f94-a3dc-0dd67657e900", debug: true } }, () => {
      try {
        assert(loggerLogSpy.calledWith({
          "allowCreateUpdateChannels": true,
          "allowDeleteChannels": true,
          "allowAddRemoveApps": true,
          "allowCreateUpdateRemoveTabs": true,
          "allowCreateUpdateRemoveConnectors": true
        }));
        done();
      }
      catch (e) {
        done(e);
      }
    });
  });

  it('fails validation if teamId is not a valid GUID', () => {
    const actual = command.validate({
      options: {
        debug: false,
        teamId: 'invalid'
      }
    });
    assert.notStrictEqual(actual, true);
  });

  it('passes validation when teamId is valid', () => {
    const actual = command.validate({
      options: {
        debug: false,
        teamId: '2609af39-7775-4f94-a3dc-0dd67657e900'
      }
    });
    assert.strictEqual(actual, true);
  });

  it('lists all properties for output json', (done) => {
    sinon.stub(request, 'get').callsFake((opts) => {
      if (opts.url === `https://graph.microsoft.com/v1.0/teams/2609af39-7775-4f94-a3dc-0dd67657e900?$select=memberSettings`) {
        return Promise.resolve({
          "memberSettings": {
            "allowCreateUpdateChannels": true,
            "allowDeleteChannels": true,
            "allowAddRemoveApps": true,
            "allowCreateUpdateRemoveTabs": true,
            "allowCreateUpdateRemoveConnectors": true
          }
        });
      }

      return Promise.reject('Invalid request');
    });

    command.action(logger, { options: { teamId: "2609af39-7775-4f94-a3dc-0dd67657e900", output: 'json', debug: false } }, () => {
      try {
        assert(loggerLogSpy.calledWith({
          "allowCreateUpdateChannels": true,
          "allowDeleteChannels": true,
          "allowAddRemoveApps": true,
          "allowCreateUpdateRemoveTabs": true,
          "allowCreateUpdateRemoveConnectors": true
        }));
        done();
      }
      catch (e) {
        done(e);
      }
    });
  });

  it('correctly handles error when listing member settings', (done) => {
    sinon.stub(request, 'get').callsFake(() => {
      return Promise.reject('An error has occurred');
    });

    command.action(logger, { options: { teamId: "2609af39-7775-4f94-a3dc-0dd67657e900", debug: false } } as any, (err?: any) => {
      try {
        assert.strictEqual(JSON.stringify(err), JSON.stringify(new CommandError('An error has occurred')));
        done();
      }
      catch (e) {
        done(e);
      }
    });
  });

  it('supports debug mode', () => {
    const options = command.options();
    let containsOption = false;
    options.forEach(o => {
      if (o.option === '--debug') {
        containsOption = true;
      }
    });
    assert(containsOption);
  });
});