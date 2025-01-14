import { PubSub } from '@google-cloud/pubsub';
import * as fs from 'fs';
import { debugGmail } from '../debuggers';
import { Accounts } from '../models';
import { getEnv } from '../utils';
import { getAuth, gmailClient } from './auth';
import { syncPartially } from './receiveEmails';
import { ICredentials, IPubsubMessage } from './types';
import { getCredentialsByEmailAccountId } from './util';

const GOOGLE_PROJECT_ID = getEnv({ name: 'GOOGLE_PROJECT_ID' });
const GOOGLE_GMAIL_TOPIC = getEnv({ name: 'GOOGLE_GMAIL_TOPIC', defaultValue: 'gmail_topic' });
const GOOGLE_APPLICATION_CREDENTIALS = getEnv({ name: 'GOOGLE_APPLICATION_CREDENTIALS', defaultValue: '' });
const GOOGLE_GMAIL_SUBSCRIPTION_NAME = getEnv({
  name: 'GOOGLE_GMAIL_SUBSCRIPTION_NAME',
  defaultValue: 'gmail_topic_subscription',
});

/**
 * Create topic and subscription for gmail
 */
export const trackGmail = async () => {
  if (!GOOGLE_PROJECT_ID || !GOOGLE_GMAIL_TOPIC || !GOOGLE_APPLICATION_CREDENTIALS || !GOOGLE_GMAIL_SUBSCRIPTION_NAME) {
    return debugGmail(`
      Error Google: Failed to create google pubsub topic following config missing
      GOOGLE_PROJECT_ID: ${GOOGLE_PROJECT_ID || 'Not defined'}
      GOOGLE_GMAIL_TOPIC: ${GOOGLE_GMAIL_TOPIC || 'Not defined'}
      GOOGLE_APPLICATION_CREDENTIALS: ${GOOGLE_APPLICATION_CREDENTIALS || 'Not defined'}
      GOOGLE_GMAIL_SUBSCRIPTION_NAME: ${GOOGLE_GMAIL_SUBSCRIPTION_NAME || 'Not defined'}
    `);
  }

  const googleCredExists = fs.existsSync(GOOGLE_APPLICATION_CREDENTIALS);

  if (!googleCredExists) {
    return debugGmail('Error Google: Google credentials file not found');
  }

  const pubsubClient: PubSub = new PubSub({
    projectId: GOOGLE_PROJECT_ID,
    keyFilename: GOOGLE_APPLICATION_CREDENTIALS,
  });

  debugGmail(`Pubsub: Check existing gmail topic in google cloud`);

  let topic = await pubsubClient.topic(GOOGLE_GMAIL_TOPIC);
  const [topicExists] = await topic.exists();

  if (!topicExists) {
    let topicResponse;

    debugGmail(`Pubsub: Creating gmail pubsub topic as ${GOOGLE_GMAIL_TOPIC}`);

    try {
      [topicResponse] = await pubsubClient.createTopic(GOOGLE_GMAIL_TOPIC);
    } catch (e) {
      return debugGmail(`Failed to create gmail topic: ${e}`);
    }

    topic = topicResponse;
  }

  debugGmail(`Pubsub: Check existing gmail subscription in google cloud`);

  const subscription = await pubsubClient.subscription(GOOGLE_GMAIL_SUBSCRIPTION_NAME);
  const [subscriptionExists] = await subscription.exists();

  if (!subscriptionExists) {
    debugGmail(`Pubsub: Creating a subscription of gmail topic`);

    const options = { flowControl: { maxBytes: 10000, maxMessages: 5 } };

    try {
      topic.createSubscription(GOOGLE_GMAIL_SUBSCRIPTION_NAME, options, (error, newSubscription) => {
        if (error) {
          debugGmail(`Pubsub: Failed to create google pubsub topic for gmail ${error}`);
          return;
        }

        newSubscription.on('message', onMessage);
        newSubscription.on('error', onError);
      });
    } catch (e) {
      debugGmail(`Failed to create subscription: ${e}`);
    }

    return;
  }

  subscription.on('message', onMessage);
  subscription.on('error', onError);
};

/**
 * Error handler for subscription of gmail
 */
const onError = (error: string) => {
  debugGmail(`Error Pubsub: occured in google pubsub subscription of gmail ${error}`);
};

/**
 * Gmail subscription receive message
 */
const onMessage = async (message: IPubsubMessage) => {
  const base64Url = message.data;
  const { emailAddress, historyId } = JSON.parse(base64Url.toString());

  debugGmail(`New email received to: ${emailAddress}`);

  const credentials = await getCredentialsByEmailAccountId({ email: emailAddress });

  // Get mailbox updates with latest received historyId
  await syncPartially(emailAddress, credentials, historyId);

  message.ack();
};

/**
 * NOTE: Before use this api Google Topic must be created in Google console
 * and grant gmail publish permission
 * Set up or update a push notification watch on the given user mailbox.
 */
export const watchPushNotification = async (accountId: string, credentials: ICredentials) => {
  if (!GOOGLE_PROJECT_ID || !GOOGLE_GMAIL_TOPIC) {
    debugGmail(
      `GOOGLE_PROJECT_ID: ${GOOGLE_PROJECT_ID || 'Not defined'}`,
      `GOOGLE_GMAIL_TOPIC: ${GOOGLE_GMAIL_TOPIC || 'Not defined'}`,
    );
  }

  const auth = getAuth(credentials, accountId);

  let response;

  debugGmail(`Google OAuthClient request to watch push notification for the given user mailbox`);

  try {
    response = await gmailClient.watch({
      auth,
      userId: 'me',
      requestBody: {
        labelIds: ['INBOX', 'CATEGORY_PERSONAL'],
        labelFilterAction: 'include',
        topicName: `projects/${GOOGLE_PROJECT_ID}/topics/${GOOGLE_GMAIL_TOPIC}`,
      },
    });
  } catch (e) {
    debugGmail(`Google OAuthClient request to watch push notification failed ${e}`);
  }

  return response;
};

/**
 * Stop receiving push notifications for the given user mailbox
 */
export const stopPushNotification = async (email: string, credentials: ICredentials) => {
  const { _id } = await Accounts.findOne({ uid: email });
  const auth = getAuth(credentials, _id);

  debugGmail(`Google OAuthClient request to stop push notification for the given user mailbox`);

  try {
    await gmailClient.stop({ auth, userId: email });
  } catch (e) {
    debugGmail(`Google OAuthClient failed to stop push notification for the given user mailbox ${e}`);
  }
};
