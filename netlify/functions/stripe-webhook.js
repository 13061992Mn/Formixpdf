const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  console.log('Received event type:', stripeEvent.type);

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        const customerId = session.customer;
        const subscriptionId = session.subscription;
        const userId = session.client_reference_id;

        console.log('checkout.session.completed data:', {
          userId,
          customerId,
          subscriptionId,
          payment_status: session.payment_status
        });

        if (!userId) {
          console.error('Missing client_reference_id (userId)');
          break;
        }

        if (!subscriptionId) {
          console.error('Missing subscriptionId on session');
          break;
        }

        const { data, error } = await supabase
          .from('subscriptions')
          .upsert(
            {
              user_id: userId,
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              status: 'active',
              updated_at: new Date().toISOString()
            },
            { onConflict: 'user_id' }
          )
          .select();

        if (error) {
          console.error('Supabase upsert error:', JSON.stringify(error, null, 2));
        } else {
          console.log('Successfully upserted subscription for user:', userId, data);
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = stripeEvent.data.object;
        const status = subscription.status;

        console.log('Subscription status change:', {
          subscriptionId: subscription.id,
          status
        });

        const { error } = await supabase
          .from('subscriptions')
          .update({
            status: status,
            updated_at: new Date().toISOString()
          })
          .eq('stripe_subscription_id', subscription.id);

        if (error) {
          console.error('Supabase update error:', JSON.stringify(error, null, 2));
        } else {
          console.log('Successfully updated subscription status to:', status);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${stripeEvent.type}`);
    }
  } catch (err) {
    console.error('Unexpected error in webhook handler:', err);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true })
  };
};
