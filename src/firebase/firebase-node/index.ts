import { FirebaseConfig } from '../datastore-firebase';
import { FbDataStore } from './datastore.firestore-node';
import * as firebaseAdmin from 'firebase-admin';

export * from '../../datastore';
export * from '../datastore-firebase';

export function createDataStore(config? : FirebaseConfig) {
    return new FbDataStore(firebaseAdmin.app(config?.appName).firestore());
}