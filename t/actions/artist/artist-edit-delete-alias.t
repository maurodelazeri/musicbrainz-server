use strict;
use warnings;

use Catalyst::Test 'MusicBrainz::Server';
use MusicBrainz::Server::Test qw( xml_ok );
use Test::More;
use Test::WWW::Mechanize::Catalyst;

my ($res, $c) = ctx_request('/');
my $mech = Test::WWW::Mechanize::Catalyst->new(catalyst_app => 'MusicBrainz::Server');

$mech->get_ok('/login');
$mech->submit_form( with_fields => { username => 'new_editor', password => 'password' } );

# Test deleting aliases
$mech->get_ok('/artist/745c079d-374e-4436-9448-da92dedef3ce/alias/1/delete');
my $response = $mech->submit_form(
    with_fields => {
        'confirm.edit_note' => ''
    });

my $edit = MusicBrainz::Server::Test->get_latest_edit($c);
isa_ok($edit, 'MusicBrainz::Server::Edit::Artist::DeleteAlias');
is_deeply($edit->data, {
    entity_id => 3,
    alias_id => 1,
});

done_testing;
