import * as bodyParser from 'body-parser';
import * as dotenv from 'dotenv';
import * as express from 'express';

// load environment variables
dotenv.config();

import initCallPro from './callpro/controller';
import { connect } from './connection';
import { debugInit, debugIntegrations, debugRequest, debugResponse } from './debuggers';
import initFacebook from './facebook/controller';
import initGmail from './gmail/controller';
import { removeIntegration } from './helpers';
import './messageQueue';
import Accounts from './models/Accounts';
import { init } from './startup';

connect();

const app = express();

const rawBodySaver = (req, _res, buf, encoding) => {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || 'utf8');

    if (req.headers.fromcore === 'true') {
      req.rawBody = req.rawBody.replace(/\//g, '\\/');
    }
  }
};

app.use(bodyParser.urlencoded({ verify: rawBodySaver, extended: true }));
app.use(bodyParser.json({ limit: '10mb', verify: rawBodySaver }));
app.use(bodyParser.raw({ verify: rawBodySaver, type: '*/*' }));

app.post('/integrations/remove', async (req, res) => {
  debugRequest(debugIntegrations, req);

  const { integrationId } = req.body;

  try {
    await removeIntegration(integrationId);
  } catch (e) {
    return res.json({ status: e.message });
  }

  debugResponse(debugIntegrations, req);

  return res.json({ status: 'ok' });
});

app.get('/accounts', async (req, res) => {
  debugRequest(debugIntegrations, req);

  const accounts = await Accounts.find({ kind: req.query.kind });

  debugResponse(debugIntegrations, req, JSON.stringify(accounts));

  return res.json(accounts);
});

app.post('/accounts/remove', async (req, res) => {
  debugRequest(debugIntegrations, req);

  const { _id } = req.body;

  try {
    await removeIntegration(_id);
    await Accounts.deleteOne({ _id });
  } catch (e) {
    return res.json({ status: e.message });
  }

  debugResponse(debugIntegrations, req);

  return res.json({ status: 'removed' });
});

// init bots
initFacebook(app);

// init gmail
initGmail(app);

// init callpro
initCallPro(app);

// Error handling middleware
app.use((error, _req, res, _next) => {
  console.error(error.stack);
  res.status(500).send(error.message);
});

const { PORT } = process.env;

app.listen(PORT, () => {
  debugInit(`Integrations server is running on port ${PORT}`);

  // Initialize startup
  init();
});
