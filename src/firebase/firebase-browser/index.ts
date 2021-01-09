import { FirebaseConfig } from '../datastore-firebase';
import * as firebase from 'firebase';
import { FbDataStore } from './datastore.firestore-browser';

export * from '../../datastore';
export * from '../datastore-firebase';

export function createDataStore(config? : FirebaseConfig) {
    return new FbDataStore(firebase.app(config?.appName).firestore());
}