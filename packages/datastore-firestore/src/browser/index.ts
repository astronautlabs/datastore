import { FirebaseConfig } from '../datastore-firebase';
import * as firebase from 'firebase/app';
import { FbDataStore } from './datastore.firestore-browser';

export * from '@astronautlabs/datastore';
export * from '../datastore-firebase';

export function createDataStore(config? : FirebaseConfig) {
    return new FbDataStore(firebase.app(config?.appName).firestore());
}