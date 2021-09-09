import { FirebaseConfig } from './datastore-firebase';

export * from '@astronautlabs/datastore';
export * from './datastore-firebase'

import { DataStore } from '@astronautlabs/datastore';

export declare function createDataStore(config? : FirebaseConfig) : DataStore;
