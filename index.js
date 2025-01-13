require('dotenv').config()
const express = require('express')
const cors = require('cors')
const app = express()
const jwt = require('jsonwebtoken')
const port = process.env.PORT || 5000
const stripe = require('stripe')(process.env.SECRET_KEYS)

// middleware 
app.use(cors())
app.use(express.json())

const verifyToken = (req, res, next) => {
    if (!req.headers.authorization) {
        return res.status(401).send('unauthorized access')
    }

    const token = req.headers.authorization.split(' ')[1]
    if (!token) {
        return res.status(401).send('unauthorized access')
    }

    jwt.verify(token, process.env.ACCESS_SECRET_TOKEN, (err, decoded) => {
        if (err) {
            return res.status(403).send('forbidden access')
        }
        req.decoded = decoded
        next()
    });
}



const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fx40ttv.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
        const database = client.db("boss-restaurant");
        const menusCollection = database.collection("menus");
        const reviewsCollection = database.collection("reviews");
        const cartsCollection = database.collection("carts");
        const usersCollection = database.collection("users");
        const paymentsCollection = database.collection("payments");

        // jwt sing in 
        app.post('/jwt-sing', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_SECRET_TOKEN, { expiresIn: '1h' });
            res.send({ token })
        })

        // middleware
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query)
            if (user.role !== 'admin') {
                console.log('hit');
                return res.status(403).send('forbidden access')
            }
            next()
        }

        app.get('/menus', async (req, res) => {
            const result = await menusCollection.find().toArray()
            res.send(result)
        })

        app.post('/menus', verifyToken, verifyAdmin, async (req, res) => {
            const items = req.body;
            const result = await menusCollection.insertOne(items)
            res.send(result)
        })

        app.delete('/menu/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await menusCollection.deleteOne(query)
            res.send(result)
        })

        app.get('/menu/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await menusCollection.findOne(query)
            res.send(result)
        })

        app.get('/reviews', async (req, res) => {
            const result = await reviewsCollection.find().toArray()
            res.send(result)
        })

        app.post('/carts', async (req, res) => {
            const cartItem = req.body;
            const result = await cartsCollection.insertOne(cartItem)
            res.send(result)
        })

        app.get('/carts', async (req, res) => {
            const email = req.query.email
            let query = {}
            if (email) {
                query.email = email
            }
            const result = await cartsCollection.find(query).toArray()
            res.send(result)
        })

        app.patch('/menu/:id', async (req, res) => {
            const updateItem = req.body;
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    name: updateItem?.name,
                    category: updateItem?.category,
                    price: updateItem?.price,
                    image: updateItem?.image,
                    recipe: updateItem?.recipe
                }
            }
            const result = await menusCollection.updateOne(filter, updateDoc)
            console.log(result);
            res.send(result)
        })

        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await cartsCollection.deleteOne(query)
            res.send(result)
        })

        // ---------------------------------------
        app.post('/users', async (req, res) => {
            const userData = req.body;
            const isEmail = await usersCollection.findOne({ email: userData.email })
            if (isEmail) {
                return res.send({ message: 'already create this account' })
            }
            const result = await usersCollection.insertOne(userData)
            res.send(result)
        })


        app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray()
            res.send(result)
        })

        app.get('/user/admin/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded.email) {
                return res.status(401).send({ message: 'Unauthorized Access' })
            }
            const query = { email: email }
            const user = await usersCollection.findOne(query)
            let admin = false;
            if (user.role === 'admin') {
                admin = true;
            }
            res.send({ admin })
        })

        app.delete('/users/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await usersCollection.deleteOne(query)
            res.send(result)
        })

        app.patch('/user/admin/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const options = { upsert: true }
            const result = await usersCollection.updateOne(filter, updateDoc, options)
            res.send(result)
        })


        // payment intent 
        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100)
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            })
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })

        app.post('/payments', async (req, res) => {
            const payment = req.body
            const paymentResult = await paymentsCollection.insertOne(payment)
            const query = {
                _id: {
                    $in: payment.cartIds.map(id => new ObjectId(id))
                }
            }

            const deleteResult = await cartsCollection.deleteMany(query)
            res.send({ paymentResult, deleteResult })
        })

        app.get('/payments-history/:email', verifyToken, async (req, res) => {
            if (req.params.email !== req.decoded.email) {
                return res.status(403).message('forbidden access')
            }
            const email = req.params.email
            const findAllPaymentHistory = await paymentsCollection.find({ email }).toArray()
            res.send(findAllPaymentHistory)
        })


        // admin home status 
        app.get('/admin-status', async (req, res) => {
            const customer = await usersCollection.estimatedDocumentCount()
            const products = await menusCollection.estimatedDocumentCount()
            const orders = await paymentsCollection.estimatedDocumentCount()
            const totalPrice = await paymentsCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        totalRevenue: { $sum: "$price" }
                    }
                }
            ]).toArray()
            // [ { _id: null, totalRevenue: 105.4 } ]
            const revenue = totalPrice[0].totalRevenue
            res.send({ customer, revenue, products, orders })
        })

        // using aggregate
        app.get('/order-stats', async (req, res) => {
            const result = await paymentsCollection.aggregate([
                {
                    $unwind: '$menuIds'
                },

                {
                    $addFields: {
                        menuIds: { $toObjectId: '$menuIds' },
                    },
                },
                // match menu collection feild 
                {
                    $lookup: {
                        from: 'menus',
                        localField: 'menuIds',
                        foreignField: '_id',
                        as: 'menuItems',
                    }
                },

                //  match array unwind
                {
                    $unwind: '$menuItems'
                },
                // group by want feild  
                {
                    $group: {
                        _id: '$menuItems.category',
                        quantity: {
                            $sum: 1
                        },
                        revenue: {
                            $sum: '$menuItems.price'
                        }
                    }
                },
                // show what i can show 
                {
                    $project: {
                        _id: 0,
                        category: '$_id',
                        quantity: '$quantity',
                        revenue: '$revenue'
                    }
                }
            ]).toArray()
            res.send(result)
        })

        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})