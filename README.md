# @/datastore

Isomorphic, abstracted, Firestore-compatible NoSQL data storage library. Use this as a better interface for Firestore.

## Features 

**Isomorphic**  
This library can be used to interface with Firestore in the same way, whether your code is running in the browser or on Node.js. 

**Better debugging of `permission-denied` errors**  
`@/datastore` will capture `permission-denied` errors from Firebase and append useful information, such as what operation was attempted that caused the `permission-denied` error. This is the number one source of frustration when working with Firestore.

## Usage (Firebase)

Install the Firebase Datastore implementation:

```
npm install @astronautlabs/datastore-firestore
```

First, initialize your app as normal using the `firebase` package (in the browser),
or the `firebase-admin` package (Node.js):

```typescript
import * as firebase from 'firebase'; // or firebase-admin for Node.js
await firebase.initializeApp({
    apiKey: "...",
    authDomain: "example.firebaseapp.com",
    databaseURL: "https://example.firebaseio.com",
    projectId: "example",
    storageBucket: "example.appspot.com",
    messagingSenderId: "..."
});
```

Then use `createDatastore()` to create your Datastore instance:

```typescript
import { createDatastore } from '@astronautlabs/datastore-firestore';

let datastore = createDatastore();
let doc = await datastore.read('/path/to/document');
```

You can also specify the Firebase app you wish to use:

```typescript
let datastore = createDatastore(appName: 'aSpecificAppName');
```
