-- Runs ONLY inside ephemeral GitHub Actions Postgres container. Never on Netlify DB.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO vsh_mixed_orders
 (id,customer_name,customer_email,amount_cents,processing_mode,
  status,checkout_id,payment_id,snapshot)
VALUES
 ('f3ff94aa-79f3-4de1-b9e2-0f112fe2df56','Test Customer','buyer@example.com',
  21499,'live','paid','checkout_CiExample98765','pay_CiExample98765',
  '{"test":true,"source":"ci-only"}'::jsonb);

INSERT INTO vsh_mixed_order_lines
 (order_id,business,product_id,title,price_cents,private_pdf_path)
VALUES
 ('f3ff94aa-79f3-4de1-b9e2-0f112fe2df56','grannys',
  'ac20bc30-83b6-4fa2-b034-e5129232a210','Recipe Book',12999,
  'grannys/ac20bc30-83b6-4fa2-b034-e5129232a210.pdf'),
 ('f3ff94aa-79f3-4de1-b9e2-0f112fe2df56','clever-cubs',
  'e4b97fe9-294d-49d5-9ae5-d1f155c9d459','Grade RR Afrikaans',8500,
  'clever-cubs/e4b97fe9-294d-49d5-9ae5-d1f155c9d459.pdf');

INSERT INTO vsh_mixed_payment_events (event_id,order_id,checkout_id,payment_id)
VALUES ('evt_test_once','f3ff94aa-79f3-4de1-b9e2-0f112fe2df56',
  'checkout_CiExample98765','pay_CiExample98765');

INSERT INTO vsh_mixed_brand_sales (order_id,business,subtotal_cents)
VALUES
 ('f3ff94aa-79f3-4de1-b9e2-0f112fe2df56','grannys',12999),
 ('f3ff94aa-79f3-4de1-b9e2-0f112fe2df56','clever-cubs',8500);

INSERT INTO vsh_mixed_email_outbox
  (id,order_id,business,kind,sender,recipient,payload)
VALUES
 ('f3ff94aa-79f3-4de1-b9e2-0f112fe2df56:grannys:customer-delivery',
  'f3ff94aa-79f3-4de1-b9e2-0f112fe2df56','grannys','customer-delivery',
  'grannyspopsandtreats@gmail.com','buyer@example.com','{"titles":["Recipe Book"]}'),
 ('f3ff94aa-79f3-4de1-b9e2-0f112fe2df56:grannys:merchant-sale-notice',
  'f3ff94aa-79f3-4de1-b9e2-0f112fe2df56','grannys','merchant-sale-notice',
  'grannyspopsandtreats@gmail.com','grannyspopsandtreats@gmail.com',
  '{"titles":["Recipe Book"]}'),
 ('f3ff94aa-79f3-4de1-b9e2-0f112fe2df56:clever-cubs:customer-delivery',
  'f3ff94aa-79f3-4de1-b9e2-0f112fe2df56','clever-cubs','customer-delivery',
  'learningclevercubs@gmail.com','buyer@example.com','{"titles":["Grade RR Afrikaans"]}'),
 ('f3ff94aa-79f3-4de1-b9e2-0f112fe2df56:clever-cubs:merchant-sale-notice',
  'f3ff94aa-79f3-4de1-b9e2-0f112fe2df56','clever-cubs','merchant-sale-notice',
  'learningclevercubs@gmail.com','learningclevercubs@gmail.com',
  '{"titles":["Grade RR Afrikaans"]}');

INSERT INTO vsh_mixed_download_grants
 (token_hash,order_id,business,product_id,expires_at)
VALUES (
 repeat('a',64),'f3ff94aa-79f3-4de1-b9e2-0f112fe2df56',
 'grannys','ac20bc30-83b6-4fa2-b034-e5129232a210',now()+interval '2 days'
);

DO $$
DECLARE
  total bigint;
  brands integer;
  jobs integer;
BEGIN
  SELECT sum(subtotal_cents),count(*) INTO total,brands FROM vsh_mixed_brand_sales;
  SELECT count(*) INTO jobs FROM vsh_mixed_email_outbox;
  IF total<>21499 OR brands<>2 OR jobs<>4 THEN
    RAISE EXCEPTION 'Mixed-brand sale reconciliation failed';
  END IF;
  IF (SELECT count(*) FROM vsh_mixed_orders)<>1 OR
     (SELECT count(*) FROM vsh_mixed_payment_events)<>1 THEN
    RAISE EXCEPTION 'Expected one Yoco payment and one master order';
  END IF;
  IF (SELECT count(*) FROM vsh_mixed_email_outbox WHERE
      business='grannys' AND payload::text LIKE '%Afrikaans%')<>0 THEN
    RAISE EXCEPTION 'Grannys order notification leaked CleverCubs items';
  END IF;
  IF (SELECT count(*) FROM vsh_mixed_email_outbox WHERE
      business='clever-cubs' AND payload::text LIKE '%Recipe Book%')<>0 THEN
    RAISE EXCEPTION 'CleverCubs order notification leaked Granny items';
  END IF;
END $$;

-- Assert unique email-job ID, unique payment event and brand-scoped PDF grant.
DO $$
BEGIN
  BEGIN
    INSERT INTO vsh_mixed_payment_events (event_id,order_id,checkout_id,payment_id)
    VALUES ('evt_test_once','f3ff94aa-79f3-4de1-b9e2-0f112fe2df56',
      'checkout_CiExample98765','pay_CiExample98765');
    RAISE EXCEPTION 'Duplicate Yoco event was accepted!';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO vsh_mixed_email_outbox
      (id,order_id,business,kind,sender,recipient,payload)
    VALUES
      ('f3ff94aa-79f3-4de1-b9e2-0f112fe2df56:grannys:customer-delivery',
       'f3ff94aa-79f3-4de1-b9e2-0f112fe2df56','grannys','customer-delivery',
       'grannyspopsandtreats@gmail.com','buyer@example.com','{}');
    RAISE EXCEPTION 'Duplicate email delivery was accepted!';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO vsh_mixed_download_grants
      (token_hash,order_id,business,product_id,expires_at)
    VALUES
      (repeat('b',64),'f3ff94aa-79f3-4de1-b9e2-0f112fe2df56',
       'clever-cubs','ac20bc30-83b6-4fa2-b034-e5129232a210',
       now()+interval '2 days');
    RAISE EXCEPTION 'Cross-brand PDF grant was accepted!';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;

ROLLBACK;
-- Verify this test never leaves fake customer data behind.
DO $$
BEGIN
  IF (SELECT count(*) FROM vsh_mixed_orders)<>0 THEN
    RAISE EXCEPTION 'CI test data unexpectedly committed';
  END IF;
END $$;
