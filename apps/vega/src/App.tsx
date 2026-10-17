import React from 'react';
import {AppNavigator, setApiBaseUrl} from '@multi-tv/shared-ui';
import '@multi-tv/shared-ui/src/app/configureRemoteControl';
import {API_BASE_URL} from './config';

setApiBaseUrl(API_BASE_URL);

export const App = () => <AppNavigator />;
