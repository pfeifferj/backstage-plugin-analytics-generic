import React from 'react';

import { createDevApp } from '@backstage/dev-utils';

import { analyticsModuleGenericPlugin } from '../src';
import { Playground } from './Playground';

createDevApp()
	.registerPlugin(analyticsModuleGenericPlugin)
	.addPage({
		title: 'Generic Analytics Playground',
		path: '/analytics-module-generic',
		element: <Playground />,
	})
	.render();
