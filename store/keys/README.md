# Store signer certificates (public)

`dev-catalog-signer.pem` is the public X.509 certificate of the **development** identity that signs
the development catalogs, the latest pointer and most development APKs. SHA-256 of the DER:
`2507930b6c21b3c1cd0655527227dba75772096eff85e887bfcce2fb25b49b29`.

It was taken from the signature block of the published
`store/distribution/dev-20261121-r109/shirohan.apk` (AWAI-3730):

```sh
unzip -p store/distribution/dev-20261121-r109/shirohan.apk META-INF/ANDROIDD.RSA \
  | openssl pkcs7 -inform DER -print_certs
openssl x509 -in store/keys/dev-catalog-signer.pem -outform DER | shasum -a 256
```

This is an Android debug certificate. It is not a production publisher key. No private key belongs
in this directory.
